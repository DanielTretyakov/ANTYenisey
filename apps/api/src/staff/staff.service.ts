import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@yenisey/database';
import type { DeskAccess, StaffCandidate, StaffHall, StaffSchedule } from '@yenisey/types';
import { shortName } from '@yenisey/types';
import type { ClubContext } from '../auth/club-context';
import { localParts } from '../club/closures';
import { StaffNotifier } from '../notifications/staff-notifier.service';
import { PrismaService } from '../prisma/prisma.service';
import { addDays, canPlanHall, canWorkDesk, SHIFT_HORIZON_DAYS, shiftDateProblem } from './shift-rules';

/** Сколько дней показывает «Расписание персонала» за раз. */
const VIEW_DAYS = 21;

/**
 * Смены администраторов (решение владельца от 26.09.2026): кто работает в
 * зале в какой день и кто может открыть «Смену».
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

  /** Смены зала: с сегодняшнего дня зала (или `from`) на три недели. */
  async schedule(club: ClubContext, hallId: string, from?: string): Promise<StaffSchedule> {
    const hall = await this.plannable(club, hallId);
    const today = localParts(new Date(), hall.timezone).date;
    const start = from && from > today ? from : today;
    const end = addDays(start, VIEW_DAYS - 1);

    const [shifts, candidates] = await Promise.all([
      this.prisma.staffShift.findMany({
        where: { tenantId: club.tenantId, hallId, date: { gte: day(start), lte: day(end) } },
        select: { date: true, userId: true },
      }),
      this.people(club.tenantId, Role.ADMIN),
    ]);

    const byDate = new Map<string, string[]>();
    for (const shift of shifts) {
      const key = shift.date.toISOString().slice(0, 10);
      byDate.set(key, [...(byDate.get(key) ?? []), shift.userId]);
    }

    return {
      hallId,
      today,
      until: addDays(today, SHIFT_HORIZON_DAYS),
      candidates,
      days: Array.from({ length: VIEW_DAYS }, (_, index) => {
        const date = addDays(start, index);
        return { date, adminIds: byDate.get(date) ?? [] };
      }),
    };
  }

  /**
   * Кто работает в зале в этот день — список целиком. Новым в списке — сообщение
   * в MAX (решение владельца от 26.09.2026); снятым — нет: их сменщик уже знает.
   */
  async setDay(club: ClubContext, hallId: string, date: string, adminIds: string[]): Promise<StaffSchedule> {
    const hall = await this.plannable(club, hallId);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Дата указывается в виде 2026-09-27');
    }

    const problem = shiftDateProblem(date, localParts(new Date(), hall.timezone).date);

    if (problem) {
      throw new BadRequestException(problem);
    }

    const wanted = [...new Set(adminIds)];
    const admins = await this.people(club.tenantId, Role.ADMIN);
    const known = new Set(admins.map((admin) => admin.id));

    if (wanted.some((id) => !known.has(id))) {
      throw new BadRequestException('На смену ставится только администратор клуба');
    }

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const before = await tx.staffShift.findMany({
        where: { hallId, date: day(date) },
        select: { userId: true },
      });
      const had = new Set(before.map((row) => row.userId));

      await tx.staffShift.deleteMany({ where: { hallId, date: day(date), userId: { notIn: wanted } } });
      await tx.staffShift.createMany({
        data: wanted
          .filter((userId) => !had.has(userId))
          .map((userId) => ({ tenantId: club.tenantId, hallId, date: day(date), userId, assignedById: club.userId })),
        skipDuplicates: true,
      });

      const [tenant, author] = await Promise.all([
        tx.tenant.findUniqueOrThrow({ where: { id: club.tenantId }, select: { name: true, slug: true } }),
        tx.user.findUniqueOrThrow({ where: { id: club.userId }, select: { fullName: true } }),
      ]);

      for (const userId of wanted.filter((id) => !had.has(id) && id !== club.userId)) {
        await this.notifier.notify(tx, {
          userId,
          tenantId: club.tenantId,
          type: 'STAFF_SHIFT_ASSIGNED',
          payload: { club: tenant.name, slug: tenant.slug, hall: hall.name, date, by: shortName(author.fullName) },
          // Снятого и назначенного снова надо известить снова — отсюда момент в ключе.
          dedupeKey: `shift:${hallId}:${date}:${now.getTime()}`,
        });
      }
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
   * залов в разных поясах «сегодня» разное.
   */
  async shiftHallIdsToday(club: Pick<ClubContext, 'tenantId' | 'userId'>, now = new Date()): Promise<string[]> {
    if (!club.userId) {
      return [];
    }

    const rows = await this.prisma.staffShift.findMany({
      where: {
        tenantId: club.tenantId,
        userId: club.userId,
        date: { gte: new Date(now.getTime() - 2 * 86_400_000), lte: new Date(now.getTime() + 2 * 86_400_000) },
      },
      select: { hallId: true, date: true, hall: { select: { timezone: true } } },
    });

    return rows
      .filter((row) => row.date.toISOString().slice(0, 10) === localParts(now, row.hall.timezone).date)
      .map((row) => row.hallId);
  }

  /** Есть ли у человека смена в этот местный день хоть в одном зале клуба. */
  async hasShiftOn(tenantId: string, userId: string, date: string): Promise<boolean> {
    const count = await this.prisma.staffShift.count({ where: { tenantId, userId, date: day(date) } });

    return count > 0;
  }

  private async onShiftToday(tenantId: string, hallId: string): Promise<string[]> {
    const hall = await this.prisma.hall.findFirst({ where: { id: hallId, tenantId }, select: { timezone: true } });

    if (!hall) {
      return [];
    }

    const rows = await this.prisma.staffShift.findMany({
      where: { hallId, date: day(localParts(new Date(), hall.timezone).date) },
      select: { admin: { select: { user: { select: { fullName: true } } } } },
    });

    return rows.map((row) => shortName(row.admin.user.fullName)).sort((a, b) => a.localeCompare(b, 'ru'));
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

/** «2026-09-27» → полночь UTC: колонка DATE часов не хранит. */
function day(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}
