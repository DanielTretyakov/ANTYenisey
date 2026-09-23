import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActorType, AuditAction, BookingStatus } from '@yenisey/database';
import type { AttendanceKind } from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';
import { parseDuration } from '../auth/tokens';
import { attendanceJobEnabled, type Env } from '../config/env';
import { decideAutoNoShow, noShowRatio, type AttendancePolicy } from './attendance-rules';
import { ClientNotifier } from '../notifications/client-notifier.service';
import { AttendanceService, ENTITY_TYPE, type LoadedEntry } from './attendance.service';

/** Сколько записей одного вида берётся за раз. */
const BATCH = 200;

/** Первый проход — не сразу при старте, а когда приложение уже отвечает. */
const FIRST_RUN_DELAY = 10_000;

const KINDS: AttendanceKind[] = ['TABLE', 'TRAINING', 'TOURNAMENT'];

/**
 * Автонеявка: запись, которую клуб не отметил за сутки после окончания,
 * становится неявкой со списанием по политике клуба (ТЗ → «Отметка
 * присутствия»).
 *
 * Свой провайдер с цепочкой `setTimeout`, а не `@nestjs/schedule`: нужен один
 * интервал, а не расписание cron, и лишняя зависимость при нестабильном TLS
 * этой машины ни к чему. Следующий проход планируется после окончания
 * предыдущего, поэтому проходы не накладываются, даже если база тормозит.
 *
 * Несколько экземпляров API безопасны: неявка ставится условным обновлением
 * `WHERE status = 'BOOKED'`, и второй экземпляр, пришедший к той же записи,
 * просто не совпадёт по статусу. То же спасает от гонки с администратором:
 * отметка держит строку `FOR UPDATE`, джоба ждёт её коммита и находит запись
 * уже отмеченной.
 */
@Injectable()
export class AutoNoShowJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AutoNoShowJob.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly attendance: AttendanceService,
    private readonly notifier: ClientNotifier,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    const enabled = attendanceJobEnabled({
      ATTENDANCE_JOB: this.config.get('ATTENDANCE_JOB', { infer: true }),
      NODE_ENV: this.config.get('NODE_ENV', { infer: true }),
    });

    if (!enabled) {
      this.logger.log('Автонеявка выключена (ATTENDANCE_JOB)');
      return;
    }

    this.logger.log(`Автонеявка включена, интервал ${this.config.get('ATTENDANCE_JOB_INTERVAL', { infer: true })}`);
    this.schedule(FIRST_RUN_DELAY);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;

    if (this.timer) {
      clearTimeout(this.timer);
    }

    // Проход, начатый до остановки, доводится: транзакции у него короткие, а
    // оборванный на полпути он ничего не сломает — но и ждать его недолго.
    await this.running;
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      this.running = this.runOnce()
        .then((count) => {
          if (count > 0) {
            this.logger.log(`Зафиксировано неявок: ${count}`);
          }
        })
        .catch((error: unknown) => {
          // Упавший проход не должен останавливать джобу навсегда: следующий
          // через интервал попробует снова.
          this.logger.error('Проход автонеявки упал', error instanceof Error ? error.stack : error);
        })
        .finally(() => {
          this.running = null;

          if (!this.stopped) {
            this.schedule(parseDuration(this.config.get('ATTENDANCE_JOB_INTERVAL', { infer: true })));
          }
        });
    }, delay);

    // Таймер не держит процесс: остановке приложения он не помеха.
    this.timer.unref();
  }

  /**
   * Один проход по всем клубам. Возвращает, сколько неявок зафиксировано.
   *
   * Открыт ради проверок: смоук ждёт прохода джобы, а не интервала.
   */
  async runOnce(now = new Date()): Promise<number> {
    const tenants = await this.prisma.tenant.findMany({
      select: {
        id: true,
        noShowChargePercent: true,
        attendanceReminderAfterMinutes: true,
        attendanceAutoNoShowAfterMinutes: true,
        attendanceTrackedSince: true,
      },
    });

    let total = 0;

    for (const tenant of tenants) {
      const policy: AttendancePolicy = {
        reminderAfterMinutes: tenant.attendanceReminderAfterMinutes,
        autoNoShowAfterMinutes: tenant.attendanceAutoNoShowAfterMinutes,
        trackedSince: tenant.attendanceTrackedSince,
      };

      // Кончившееся не позже этого момента пора закрывать.
      const cutoff = new Date(now.getTime() - policy.autoNoShowAfterMinutes * 60_000);

      if (cutoff < policy.trackedSince) {
        continue;
      }

      for (const kind of KINDS) {
        total += await this.closeKind(tenant.id, kind, policy, cutoff, now, tenant.noShowChargePercent);
      }
    }

    return total;
  }

  private async closeKind(
    tenantId: string,
    kind: AttendanceKind,
    policy: AttendancePolicy,
    cutoff: Date,
    now: Date,
    percent: number,
  ): Promise<number> {
    let closed = 0;

    for (;;) {
      const candidates = await this.candidates(tenantId, kind, policy.trackedSince, cutoff);
      let progressed = 0;

      for (const entry of candidates) {
        // Запрос отбирает тем же условием, но решение принимается ещё раз:
        // ошибка в запросе — это неявки у людей, которые пришли.
        if (!decideAutoNoShow(entry, policy, now)) {
          continue;
        }

        if (await this.close(tenantId, kind, entry, percent, policy, now)) {
          closed += 1;
        }

        progressed += 1;
      }

      // Обработанные из выборки ушли (статус больше не BOOKED), так что
      // следующая пачка — свежая. Пачка без единого решения значит, что
      // запрос и правила разошлись, и крутиться дальше бессмысленно.
      if (candidates.length < BATCH || progressed === 0) {
        return closed;
      }
    }
  }

  /**
   * Неявка одной записи — своей транзакцией.
   *
   * Своей, а не одной на пачку: запись, которую в эту секунду отмечает
   * администратор, подождёт свою блокировку, а не задержит двести остальных.
   */
  private async close(
    tenantId: string,
    kind: AttendanceKind,
    entry: LoadedEntry,
    percent: number,
    policy: AttendancePolicy,
    now: Date,
  ): Promise<boolean> {
    // Тем же правилом, что у отметки администратором. Журнал абонемента джоба
    // при этом не трогает вовсе: визит списан ещё при записи, «сгорел» это и
    // значит.
    const ratio = noShowRatio(kind, entry, percent);

    return this.prisma.$transaction(async (tx) => {
      const updated = await this.attendance.updateEntry(
        tx,
        kind,
        entry.id,
        { status: BookingStatus.NO_SHOW, chargeRatio: ratio, autoNoShowAppliedAt: now },
        BookingStatus.BOOKED,
      );

      // Администратор успел отметить, пока джоба шла к записи.
      if (updated === 0) {
        return false;
      }

      // Автора у визита нет: неявку поставил не человек. База пропускает
      // пустого автора только у неявки по записи (раздел 17 constraints.sql).
      await this.attendance.writeVisit(tx, tenantId, kind, entry, false, null);

      await tx.auditLog.create({
        data: {
          tenantId,
          action: AuditAction.AUTO_NO_SHOW_APPLIED,
          actorType: ActorType.SYSTEM_JOB,
          entityType: ENTITY_TYPE[kind],
          entityId: entry.id,
          before: { status: BookingStatus.BOOKED, chargeRatio: entry.chargeRatio },
          after: { status: BookingStatus.NO_SHOW, chargeRatio: ratio },
          reason: `Присутствие не отмечено за ${formatDelay(policy.autoNoShowAfterMinutes)} после окончания`,
        },
      });

      await this.notifier.entryNoShow(tx, tenantId, kind, entry.id, now);

      return true;
    });
  }

  /** Неотмеченные записи, закончившиеся в учётном окне и не позже `cutoff`. */
  private async candidates(
    tenantId: string,
    kind: AttendanceKind,
    since: Date,
    cutoff: Date,
  ): Promise<LoadedEntry[]> {
    const window = { gte: since, lte: cutoff };
    const booked = { tenantId, status: BookingStatus.BOOKED };

    switch (kind) {
      case 'TABLE': {
        const rows = await this.prisma.tableBooking.findMany({
          where: { ...booked, endsAt: window },
          select: {
            id: true,
            status: true,
            chargeRatio: true,
            startsAt: true,
            endsAt: true,
            clientId: true,
            coachId: true,
          },
          orderBy: { endsAt: 'asc' },
          take: BATCH,
        });

        return rows.map((row) => ({ ...row, subscriptionId: null }));
      }

      case 'TRAINING': {
        const rows = await this.prisma.trainingBooking.findMany({
          where: { ...booked, session: { endsAt: window } },
          select: {
            id: true,
            status: true,
            chargeRatio: true,
            clientId: true,
            subscriptionId: true,
            session: { select: { startsAt: true, endsAt: true, coachId: true } },
          },
          take: BATCH,
        });

        return rows.map(({ session, ...row }) => ({ ...row, ...session }));
      }

      case 'TOURNAMENT': {
        const rows = await this.prisma.tournamentRegistration.findMany({
          where: { ...booked, tournament: { endsAt: window } },
          select: {
            id: true,
            status: true,
            chargeRatio: true,
            clientId: true,
            subscriptionId: true,
            tournament: { select: { startsAt: true, endsAt: true } },
          },
          take: BATCH,
        });

        return rows.map(({ tournament, ...row }) => ({ ...row, ...tournament, coachId: null }));
      }
    }
  }
}

/** «24 ч», «90 мин» — для причины в журнале. */
function formatDelay(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60} ч` : `${minutes} мин`;
}
