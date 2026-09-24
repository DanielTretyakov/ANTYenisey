import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookingStatus, GuardianshipStatus } from '@yenisey/database';
import { notificationsJobEnabled, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { ClientNotifier, loadEntry } from './client-notifier.service';
import { DigestSchedule } from './digest-schedule';
import { clubTimezone, zoneClock } from './clock';
import { MaxTransport } from './max.transport';
import { reminderAt, reminderDue } from './notification-rules';
import type { EntryKind } from './render';
import { StaffSchedule, type SchedulePart } from './staff-schedule';

const ALL_PARTS: ReadonlySet<SchedulePart> = new Set(['clients', 'escalations', 'coachPlans', 'digests']);

/** Раз в минуту: напоминание не должно опаздывать больше, чем на минуту. */
const INTERVAL_MS = 60_000;

const FIRST_RUN_DELAY = 15_000;

/**
 * Как далеко вперёд смотреть на записи. Самое раннее напоминание — в 20:00
 * накануне занятия в 10:59, почти за пятнадцать часов; шестнадцать с запасом.
 */
const LOOKAHEAD_MS = 16 * 3_600_000;

/** За сколько дней до конца срока предупреждать об абонементе. */
const EXPIRY_NOTICE_DAYS = 3;

/**
 * Планировщик уведомлений: то, что случается не по действию человека, а по
 * часам, — напоминания о записях и концы абонементов; персоналу — эскалация
 * неотмеченного присутствия и план тренера (StaffSchedule); утренние сводки
 * клуба и платформы (DigestSchedule).
 *
 * Сам ничего не шлёт — ставит строки в очередь, откуда их заберёт отправщик.
 * Ключи идемпотентности делают проход безопасным повторять: второй проход за
 * ту же минуту и второй экземпляр API не поставят второе напоминание.
 *
 * Смотрит только на тех, кому есть куда слать: привязавших MAX и детей таких
 * родителей. Остальным строка всё равно не встала бы, а перебирать все
 * записи платформы каждую минуту незачем.
 */
@Injectable()
export class NotificationScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NotificationScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: ClientNotifier,
    private readonly staff: StaffSchedule,
    private readonly digests: DigestSchedule,
    private readonly transport: MaxTransport,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    const enabled = notificationsJobEnabled({
      NOTIFICATIONS_JOB: this.config.get('NOTIFICATIONS_JOB', { infer: true }),
      NODE_ENV: this.config.get('NODE_ENV', { infer: true }),
    });

    if (enabled && this.transport.mode !== 'off') {
      this.schedule(FIRST_RUN_DELAY);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;

    if (this.timer) {
      clearTimeout(this.timer);
    }

    await this.running;
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      this.running = this.runOnce()
        .catch((error: unknown) => {
          this.logger.error('Проход планировщика упал', error instanceof Error ? error.stack : error);
        })
        .finally(() => {
          this.running = null;

          if (!this.stopped) {
            this.schedule(INTERVAL_MS);
          }
        });
    }, delay);

    this.timer.unref();
  }

  /**
   * Один проход. Открыт ради проверок: смоук зовёт его с подставным «сейчас»,
   * чтобы не ждать трёх часов до напоминания.
   *
   * `parts` — какие части прохода выполнять. Нужно ровно смоуку: проход с
   * «сейчас» через три дня целиком пометил бы напомненными настоящие записи
   * базы, которые к тому «сейчас» кончились бы.
   */
  async runOnce(now = new Date(), parts: ReadonlySet<SchedulePart> = ALL_PARTS): Promise<{
    reminders: number;
    subscriptions: number;
    escalations: number;
    coachPlans: number;
    clubDigests: number;
    platformDigests: number;
  }> {
    const staff = {
      ...(await this.staff.runOnce(now, parts)),
      ...(parts.has('digests') ? await this.digests.runOnce(now) : { clubDigests: 0, platformDigests: 0 }),
    };
    const clients = parts.has('clients') ? await this.reachableClients() : [];

    if (clients.length === 0) {
      return { reminders: 0, subscriptions: 0, ...staff };
    }

    return {
      reminders: await this.reminders(clients, now),
      subscriptions: await this.subscriptions(clients, now),
      ...staff,
    };
  }

  /** Клиенты, о которых есть кому сообщить: сами с MAX или их родитель с MAX. */
  private async reachableClients(): Promise<string[]> {
    const linked = await this.prisma.maxLink.findMany({ where: { blockedAt: null }, select: { userId: true } });
    const ids = linked.map((link) => link.userId);

    if (ids.length === 0) {
      return [];
    }

    // Права родителя по возрасту ребёнка проверит сам ClientNotifier: здесь
    // лишний ребёнок старше 16 стоит один запрос, а не лишнее сообщение.
    const children = await this.prisma.guardianship.findMany({
      where: { guardianUserId: { in: ids }, status: GuardianshipStatus.ACTIVE },
      select: { childUserId: true },
    });

    return [...new Set([...ids, ...children.map((row) => row.childUserId)])];
  }

  private async reminders(clients: string[], now: Date): Promise<number> {
    const window = { gt: now, lte: new Date(now.getTime() + LOOKAHEAD_MS) };
    const booked = { clientId: { in: clients }, status: BookingStatus.BOOKED };

    const [tables, trainings, tournaments] = await Promise.all([
      this.prisma.tableBooking.findMany({ where: { ...booked, startsAt: window }, select: { id: true, tenantId: true } }),
      this.prisma.trainingBooking.findMany({
        where: { ...booked, session: { startsAt: window } },
        select: { id: true, tenantId: true },
      }),
      this.prisma.tournamentRegistration.findMany({
        where: { ...booked, tournament: { startsAt: window } },
        select: { id: true, tenantId: true },
      }),
    ]);

    const entries: { kind: EntryKind; id: string; tenantId: string }[] = [
      ...tables.map((row) => ({ kind: 'TABLE' as const, ...row })),
      ...trainings.map((row) => ({ kind: 'TRAINING' as const, ...row })),
      ...tournaments.map((row) => ({ kind: 'TOURNAMENT' as const, ...row })),
    ];

    let queued = 0;

    for (const entry of entries) {
      const facts = await loadEntry(this.prisma, entry.tenantId, entry.kind, entry.id);

      if (!facts || facts.status !== BookingStatus.BOOKED) {
        continue;
      }

      if (!reminderDue(facts, reminderAt(facts.startsAt, zoneClock(facts.timezone)), now)) {
        continue;
      }

      queued += await this.notifier.entryReminder(this.prisma, facts, now);
    }

    return queued;
  }

  /**
   * Абонементы, о которых пора сказать: срок кончается через три дня, остался
   * последний визит, визиты кончились.
   *
   * «Кончились» — только у абонемента, срок которого ещё идёт, и только если
   * другого действующего у человека в этом клубе нет: купивший новый
   * абонемент о старом слышать не должен.
   */
  private async subscriptions(clients: string[], now: Date): Promise<number> {
    const soon = new Date(now.getTime() + EXPIRY_NOTICE_DAYS * 86_400_000);
    const alive = { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };

    const rows = await this.prisma.subscription.findMany({
      where: {
        clientId: { in: clients },
        AND: [
          alive,
          {
            OR: [
              { expiresAt: { gt: now, lte: soon }, OR: [{ remainingVisits: null }, { remainingVisits: { gt: 0 } }] },
              { remainingVisits: { in: [0, 1] } },
            ],
          },
        ],
      },
      select: {
        id: true,
        tenantId: true,
        clientId: true,
        expiresAt: true,
        remainingVisits: true,
        plan: { select: { name: true, visitsCount: true } },
        tenant: { select: { name: true } },
        soldAtHall: { select: { timezone: true } },
      },
    });

    let queued = 0;

    for (const row of rows) {
      const reason =
        row.remainingVisits === 0
          ? 'NO_VISITS'
          : row.remainingVisits === 1 && (row.plan.visitsCount ?? 0) > 1
            ? 'LAST_VISIT'
            : row.expiresAt && row.expiresAt <= soon
              ? 'EXPIRES'
              : null;

      if (!reason) {
        continue;
      }

      if (reason === 'NO_VISITS' && (await this.hasAnotherActive(row.tenantId, row.clientId, row.id, now))) {
        continue;
      }

      queued += await this.notifier.subscriptionEnding(
        this.prisma,
        {
          id: row.id,
          tenantId: row.tenantId,
          clientId: row.clientId,
          plan: row.plan.name,
          club: row.tenant.name,
          timezone: row.soldAtHall?.timezone ?? (await clubTimezone(this.prisma, row.tenantId)),
          expiresAt: row.expiresAt,
          remainingVisits: row.remainingVisits,
        },
        reason,
        now,
      );
    }

    return queued;
  }

  private async hasAnotherActive(tenantId: string, clientId: string, exceptId: string, now: Date): Promise<boolean> {
    const other = await this.prisma.subscription.findFirst({
      where: {
        tenantId,
        clientId,
        id: { not: exceptId },
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          { OR: [{ remainingVisits: null }, { remainingVisits: { gt: 0 } }] },
        ],
      },
      select: { id: true },
    });

    return other !== null;
  }
}
