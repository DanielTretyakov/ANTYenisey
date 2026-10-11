import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, type Prisma } from '@yenisey/database';
import type { DeskAccess, StaffCandidate, StaffHall, StaffSchedule } from '@yenisey/types';
import { shortName } from '@yenisey/types';
import type { ClubContext } from '../auth/club-context';
import { localParts } from '../club/closures';
import { StaffNotifier } from '../notifications/staff-notifier.service';
import { PrismaService } from '../prisma/prisma.service';
import { dayOf, effectiveShifts } from './shift-reader';
import { addDays, canPlanHall, canWorkDesk, SHIFT_HORIZON_DAYS, shiftDateProblem } from './shift-rules';

/** Сколько дней показывает «Расписание персонала» за раз. */
const VIEW_DAYS = 21;

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * Смены администраторов (решения владельца от 26.09 и 10.10.2026): кто
 * работает в зале в какой день и кто может открыть «Смену».
 *
 * У зала — шаблон недели («по понедельникам — Иванова»), а день, назначенный
 * вручную, его перекрывает (замена, больничный, «никого»). Кто на смене в
 * конкретный день, решает одна выборка — `effectiveShifts`.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: StaffNotifier,
  ) {}

  /** Залы клуба для «Расписания персонала»: с управляющим и отметкой «можно планировать». */
  async halls(club: ClubContext): Promise<StaffHall[]> {
    const [halls, managed] = await Promise.all([
      this.prisma.hall.findMany({
        where: { tenantId: club.tenantId },
        select: {
          id: true,
          name: true,
          managerId: true,
          city: { select: { name: true } },
          manager: { select: { user: { select: { fullName: true } } } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.managedHallIds(club),
    ]);

    return halls.map((hall) => ({
      id: hall.id,
      name: hall.name,
      city: hall.city?.name ?? null,
      managerId: hall.managerId,
      managerName: hall.manager ? hall.manager.user.fullName : null,
      canPlan: canPlanHall(club.roles, managed, hall.id),
    }));
  }

  /** Люди с ролью управляющего — кого руководитель может поставить на зал. */
  async managerCandidates(tenantId: string): Promise<StaffCandidate[]> {
    return this.people(tenantId, Role.MANAGER);
  }

  /** Смены зала: с сегодняшнего дня зала (или `from`) на три недели, и шаблон недели. */
  async schedule(club: ClubContext, hallId: string, from?: string): Promise<StaffSchedule> {
    const hall = await this.plannable(club, hallId);
    const today = localParts(new Date(), hall.timezone).date;
    const start = from && from > today ? from : today;
    const dates = Array.from({ length: VIEW_DAYS }, (_, index) => addDays(start, index));

    const [shifts, template, candidates] = await Promise.all([
      effectiveShifts(
        this.prisma,
        club.tenantId,
        dates.map((date) => ({ hallId, date })),
      ),
      this.templateOf(club.tenantId, hallId),
      this.people(club.tenantId, Role.ADMIN),
    ]);

    return {
      hallId,
      today,
      until: addDays(today, SHIFT_HORIZON_DAYS),
      candidates,
      template: WEEKDAYS.map((weekday) => ({ weekday, adminIds: template.get(weekday) ?? [] })),
      days: dates.map((date) => {
        const shift = shifts.get(`${hallId}:${date}`);
        return { date, adminIds: shift?.adminIds ?? [], source: shift?.source ?? 'TEMPLATE' };
      }),
    };
  }

  /**
   * Кто работает в зале в этот день — список целиком; день становится
   * назначенным вручную и шаблон его больше не трогает. Новым на смене —
   * сообщение в MAX (решение владельца от 26.09.2026); снятым — нет: их
   * сменщик уже знает. «Новым» — против того, кто был на смене до правки, в
   * том числе по шаблону: иначе снятие одного из шаблонной пары известило бы
   * второго, будто его назначили.
   */
  async setDay(club: ClubContext, hallId: string, date: string, adminIds: string[]): Promise<StaffSchedule> {
    const hall = await this.plannable(club, hallId);
    this.assertPlannableDate(date, hall.timezone);

    const wanted = await this.knownAdmins(club.tenantId, adminIds);

    await this.prisma.$transaction(async (tx) => {
      const before = await this.onDate(tx, club.tenantId, hallId, date);

      await tx.staffShiftDay.upsert({
        where: { hallId_date: { hallId, date: dayOf(date) } },
        update: { setById: club.userId, setAt: new Date() },
        create: { tenantId: club.tenantId, hallId, date: dayOf(date), setById: club.userId },
      });
      await tx.staffShift.deleteMany({ where: { hallId, date: dayOf(date), userId: { notIn: wanted } } });
      await tx.staffShift.createMany({
        data: wanted.map((userId) => ({ tenantId: club.tenantId, hallId, date: dayOf(date), userId, assignedById: club.userId })),
        skipDuplicates: true,
      });

      await this.tellAssigned(tx, club, hall.name, wanted.filter((id) => !before.includes(id)), { date }, `shift:${hallId}:${date}`);
    });

    return this.schedule(club, hallId);
  }

  /**
   * Вернуть день к шаблону недели: ручное назначение снимается целиком.
   * Тем, кто теперь на смене по шаблону, а до этого не был, — сообщение.
   */
  async resetDay(club: ClubContext, hallId: string, date: string): Promise<StaffSchedule> {
    const hall = await this.plannable(club, hallId);
    this.assertPlannableDate(date, hall.timezone);

    await this.prisma.$transaction(async (tx) => {
      const before = await this.onDate(tx, club.tenantId, hallId, date);

      await tx.staffShift.deleteMany({ where: { hallId, date: dayOf(date) } });
      await tx.staffShiftDay.deleteMany({ where: { hallId, date: dayOf(date) } });

      const after = await this.onDate(tx, club.tenantId, hallId, date);

      await this.tellAssigned(tx, club, hall.name, after.filter((id) => !before.includes(id)), { date }, `shift:${hallId}:${date}`);
    });

    return this.schedule(club, hallId);
  }

  /**
   * Шаблон недели зала — список дня недели целиком (решение владельца от
   * 10.10.2026). Ручные дни он не трогает. Новым в шаблоне — сообщение «вы на
   * смене по понедельникам»: о каждом дне по шаблону отдельного не будет.
   */
  async setTemplate(club: ClubContext, hallId: string, weekday: number, adminIds: string[]): Promise<StaffSchedule> {
    const hall = await this.plannable(club, hallId);

    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      throw new BadRequestException('День недели — от 1 (понедельник) до 7 (воскресенье)');
    }

    const wanted = await this.knownAdmins(club.tenantId, adminIds);

    await this.prisma.$transaction(async (tx) => {
      const before = await tx.staffShiftTemplate.findMany({ where: { hallId, weekday }, select: { userId: true } });
      const had = new Set(before.map((row) => row.userId));

      await tx.staffShiftTemplate.deleteMany({ where: { hallId, weekday, userId: { notIn: wanted } } });
      await tx.staffShiftTemplate.createMany({
        data: wanted.map((userId) => ({ tenantId: club.tenantId, hallId, weekday, userId, assignedById: club.userId })),
        skipDuplicates: true,
      });

      await this.tellAssigned(tx, club, hall.name, wanted.filter((id) => !had.has(id)), { weekday }, `shift-template:${hallId}:${weekday}`);
    });

    return this.schedule(club, hallId);
  }

  /** Может ли смотрящий открыть «Смену» (в этом зале) и кто сегодня на ней. */
  async deskAccess(club: ClubContext, hallId: string | null): Promise<DeskAccess> {
    const [managed, shifts] = await Promise.all([this.managedHallIds(club), this.shiftHallIdsToday(club)]);
    const access = canWorkDesk({ roles: club.roles, hallId, managedHallIds: managed, shiftHallIdsToday: shifts });

    return {
      allowed: access.ok,
      message: access.ok ? null : access.message,
      onShift: hallId ? await this.onShiftToday(club.tenantId, hallId) : [],
    };
  }

  /** То же для guard'а: отказ — исключением. */
  async assertDesk(club: ClubContext, hallId: string | null): Promise<void> {
    const access = await this.deskAccess(club, hallId);

    if (!access.allowed) {
      throw new ForbiddenException(access.message ?? 'Сегодня вы не работаете');
    }
  }

  /**
   * Залы, где у человека смена СЕГОДНЯ — по местной дате каждого зала: у
   * залов в разных поясах «сегодня» разное. По шаблону или по ручному дню.
   */
  async shiftHallIdsToday(club: Pick<ClubContext, 'tenantId' | 'userId'>, now = new Date()): Promise<string[]> {
    if (!club.userId) {
      return [];
    }

    const halls = await this.prisma.hall.findMany({ where: { tenantId: club.tenantId }, select: { id: true, timezone: true } });

    return this.hallsWith(club.tenantId, club.userId, halls.map((hall) => ({ hallId: hall.id, date: localParts(now, hall.timezone).date })));
  }

  /** Есть ли у человека смена в этот местный день хоть в одном зале клуба. */
  async hasShiftOn(tenantId: string, userId: string, date: string): Promise<boolean> {
    const halls = await this.prisma.hall.findMany({ where: { tenantId }, select: { id: true } });
    const found = await this.hallsWith(tenantId, userId, halls.map((hall) => ({ hallId: hall.id, date })));

    return found.length > 0;
  }

  private async hallsWith(tenantId: string, userId: string, slots: { hallId: string; date: string }[]): Promise<string[]> {
    const shifts = await effectiveShifts(this.prisma, tenantId, slots);

    return slots
      .filter((slot) => shifts.get(`${slot.hallId}:${slot.date}`)?.adminIds.includes(userId))
      .map((slot) => slot.hallId);
  }

  private async onShiftToday(tenantId: string, hallId: string): Promise<string[]> {
    const hall = await this.prisma.hall.findFirst({ where: { id: hallId, tenantId }, select: { timezone: true } });

    if (!hall) {
      return [];
    }

    const date = localParts(new Date(), hall.timezone).date;
    const adminIds = (await effectiveShifts(this.prisma, tenantId, [{ hallId, date }])).get(`${hallId}:${date}`)?.adminIds ?? [];
    const people = await this.prisma.user.findMany({ where: { id: { in: adminIds } }, select: { fullName: true } });

    return people.map((person) => shortName(person.fullName)).sort((a, b) => a.localeCompare(b, 'ru'));
  }

  /** Кто на смене в зале в этот день — в транзакции правки. */
  private async onDate(tx: Prisma.TransactionClient, tenantId: string, hallId: string, date: string): Promise<string[]> {
    return (await effectiveShifts(tx, tenantId, [{ hallId, date }])).get(`${hallId}:${date}`)?.adminIds ?? [];
  }

  private async templateOf(tenantId: string, hallId: string): Promise<Map<number, string[]>> {
    const rows = await this.prisma.staffShiftTemplate.findMany({
      where: { tenantId, hallId, admin: { deactivatedAt: null, roles: { has: Role.ADMIN } } },
      select: { weekday: true, userId: true },
    });
    const map = new Map<number, string[]>();

    for (const row of rows) map.set(row.weekday, [...(map.get(row.weekday) ?? []), row.userId]);

    return map;
  }

  /** Назначенным — сообщение в MAX: на день или по дню недели. */
  private async tellAssigned(
    tx: Prisma.TransactionClient,
    club: ClubContext,
    hallName: string,
    userIds: string[],
    when: { date: string } | { weekday: number },
    key: string,
  ): Promise<void> {
    const recipients = userIds.filter((id) => id !== club.userId);

    if (recipients.length === 0) return;

    const [tenant, author] = await Promise.all([
      tx.tenant.findUniqueOrThrow({ where: { id: club.tenantId }, select: { name: true, slug: true } }),
      tx.user.findUniqueOrThrow({ where: { id: club.userId }, select: { fullName: true } }),
    ]);
    const now = Date.now();

    for (const userId of recipients) {
      await this.notifier.notify(tx, {
        userId,
        tenantId: club.tenantId,
        type: 'STAFF_SHIFT_ASSIGNED',
        payload: { club: tenant.name, slug: tenant.slug, hall: hallName, ...when, by: shortName(author.fullName) },
        // Снятого и назначенного снова надо известить снова — отсюда момент в ключе.
        dedupeKey: `${key}:${now}`,
      });
    }
  }

  private assertPlannableDate(date: string, timezone: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Дата указывается в виде 2026-09-27');
    }

    const problem = shiftDateProblem(date, localParts(new Date(), timezone).date);

    if (problem) {
      throw new BadRequestException(problem);
    }
  }

  /** Только действующие администраторы клуба; повторы снимаются. */
  private async knownAdmins(tenantId: string, adminIds: string[]): Promise<string[]> {
    const wanted = [...new Set(adminIds)];
    const known = new Set((await this.people(tenantId, Role.ADMIN)).map((admin) => admin.id));

    if (wanted.some((id) => !known.has(id))) {
      throw new BadRequestException('На смену ставится только администратор клуба');
    }

    return wanted;
  }

  private async managedHallIds(club: Pick<ClubContext, 'tenantId' | 'userId' | 'roles'>): Promise<string[]> {
    if (!club.roles.includes('MANAGER') || !club.userId) {
      return [];
    }

    const halls = await this.prisma.hall.findMany({
      where: { tenantId: club.tenantId, managerId: club.userId },
      select: { id: true },
    });

    return halls.map((hall) => hall.id);
  }

  /** Зал, если смотрящий вправе планировать в нём смены; иначе 403/404. */
  private async plannable(club: ClubContext, hallId: string): Promise<{ name: string; timezone: string }> {
    const hall = await this.prisma.hall.findFirst({
      where: { id: hallId, tenantId: club.tenantId },
      select: { name: true, timezone: true },
    });

    if (!hall) {
      throw new NotFoundException('Зал не найден');
    }

    if (!canPlanHall(club.roles, await this.managedHallIds(club), hallId)) {
      throw new ForbiddenException('Смены в этом зале назначает его управляющий или руководитель');
    }

    return hall;
  }

  private async people(tenantId: string, role: Role): Promise<StaffCandidate[]> {
    const rows = await this.prisma.tenantMembership.findMany({
      where: { tenantId, roles: { has: role }, deactivatedAt: null, user: { deactivatedAt: null, anonymizedAt: null } },
      select: { userId: true, user: { select: { fullName: true } } },
      orderBy: { user: { fullName: 'asc' } },
    });

    return rows.map((row) => ({ id: row.userId, fullName: row.user.fullName }));
  }
}
