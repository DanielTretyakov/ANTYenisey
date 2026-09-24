import { Injectable } from '@nestjs/common';
import { BookingStatus, Role, type Prisma } from '@yenisey/database';
import { shortName } from '@yenisey/types';
import { escalationDue, type AttendancePolicy } from '../attendance/attendance-rules';
import { PrismaService } from '../prisma/prisma.service';
import { clubTimezone, zoneClock } from './clock';
import { morningDue } from './notification-rules';
import type { CoachDayPayload, EntryKind, EscalationPayload } from './render';
import { StaffNotifier } from './staff-notifier.service';

/** Часть прохода планировщика: клиентам, эскалации, планы тренеров. */
export type SchedulePart = 'clients' | 'escalations' | 'coachPlans';

/** Одна неотмеченная группа: занятие, турнир или бронь стола. */
interface PendingGroup {
  kind: EntryKind;
  groupId: string;
  entryIds: string[];
  ownerIds: string[];
  title: string;
  startsAt: Date;
  endsAt: Date;
  place: string | null;
  timezone: string;
}

/**
 * Сообщения персоналу по часам: эскалация неотмеченного присутствия и план
 * тренера на день. Абонементы клиентов и новых людей администраторы видят в
 * утренней сводке клуба. Часть NotificationScheduler — он и
 * зовёт `runOnce` раз в минуту.
 *
 * Смотрит только на клубы, где хоть кто-то из персонала привязал MAX: иначе
 * слать некому, а `reminderSentAt` без отправленного напоминания был бы
 * неправдой.
 */
@Injectable()
export class StaffSchedule {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staff: StaffNotifier,
  ) {}

  async runOnce(now: Date, parts: ReadonlySet<SchedulePart>): Promise<{ escalations: number; coachPlans: number }> {
    if (!parts.has('escalations') && !parts.has('coachPlans')) {
      return { escalations: 0, coachPlans: 0 };
    }

    const linked = (await this.prisma.maxLink.findMany({ where: { blockedAt: null }, select: { userId: true } })).map(
      (link) => link.userId,
    );

    if (linked.length === 0) {
      return { escalations: 0, coachPlans: 0 };
    }

    const roles = await this.prisma.tenantMembership.findMany({
      where: { userId: { in: linked }, deactivatedAt: null, role: { in: [Role.ADMIN, Role.OWNER, Role.COACH] } },
      select: { userId: true, tenantId: true, role: true },
    });

    const staffTenants = [...new Set(roles.filter((row) => row.role !== Role.COACH).map((row) => row.tenantId))];
    const coaches = roles.filter((row) => row.role === Role.COACH);

    let escalations = 0;
    let coachPlans = 0;

    for (const tenantId of parts.has('escalations') ? staffTenants : []) {
      escalations += await this.escalate(tenantId, now);
    }

    for (const coach of parts.has('coachPlans') ? coaches : []) {
      coachPlans += await this.coachPlan(coach.tenantId, coach.userId, now);
    }

    return { escalations, coachPlans };
  }

  /**
   * Через час после окончания — администраторам, если присутствие не отмечено
   * (ТЗ). Одно сообщение на мероприятие, а не на запись; `reminderSentAt`
   * ставится той же транзакцией, условным обновлением, — второй проход и второй
   * экземпляр API запись уже не возьмут.
   */
  private async escalate(tenantId: string, now: Date): Promise<number> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        attendanceReminderAfterMinutes: true,
        attendanceAutoNoShowAfterMinutes: true,
        attendanceTrackedSince: true,
        name: true,
        slug: true,
      },
    });

    const policy: AttendancePolicy = {
      reminderAfterMinutes: tenant.attendanceReminderAfterMinutes,
      autoNoShowAfterMinutes: tenant.attendanceAutoNoShowAfterMinutes,
      trackedSince: tenant.attendanceTrackedSince,
    };

    let sent = 0;

    for (const group of await this.pendingGroups(tenantId, policy, now)) {
      sent += await this.prisma.$transaction(async (tx) => {
        const marked = await markReminded(tx, group.kind, group.entryIds, now);

        if (marked === 0) {
          return 0;
        }

        const people = await tx.user.findMany({ where: { id: { in: group.ownerIds } }, select: { fullName: true } });
        const payload: EscalationPayload = {
          kind: group.kind,
          title: group.title,
          startsAt: group.startsAt.toISOString(),
          endsAt: group.endsAt.toISOString(),
          timezone: group.timezone,
          place: group.place,
          club: tenant.name,
          slug: tenant.slug,
          people: people.map((person) => shortName(person.fullName)).sort((a, b) => a.localeCompare(b, 'ru')),
          count: group.entryIds.length,
        };

        return this.staff.toStaff(
          tx,
          tenantId,
          'ATTENDANCE_ESCALATION_HOUR',
          payload,
          `escalation:${group.kind}:${group.groupId}`,
          now,
          [],
          group.timezone,
        );
      });
    }

    return sent;
  }

  /** Неотмеченные записи клуба, которым пора напомнить, — по мероприятиям. */
  private async pendingGroups(tenantId: string, policy: AttendancePolicy, now: Date): Promise<PendingGroup[]> {
    const MINUTE = 60_000;
    const window = {
      gte: new Date(Math.max(policy.trackedSince.getTime(), now.getTime() - policy.autoNoShowAfterMinutes * MINUTE)),
      lte: new Date(now.getTime() - policy.reminderAfterMinutes * MINUTE),
    };
    const open = { tenantId, status: BookingStatus.BOOKED, reminderSentAt: null };
    const hall = { select: { name: true, timezone: true } } as const;
    const placed = { take: 1, select: { schedule: { select: { hall } } } } as const;
    const fallback = await clubTimezone(this.prisma, tenantId);

    const [tables, trainings, tournaments] = await Promise.all([
      this.prisma.tableBooking.findMany({
        where: { ...open, endsAt: window },
        select: {
          id: true,
          clientId: true,
          coachId: true,
          isSparring: true,
          startsAt: true,
          endsAt: true,
          reminderSentAt: true,
          status: true,
          table: { select: { label: true, hall } },
        },
      }),
      this.prisma.trainingBooking.findMany({
        where: { ...open, session: { endsAt: window } },
        select: {
          id: true,
          clientId: true,
          sessionId: true,
          reminderSentAt: true,
          status: true,
          session: { select: { startsAt: true, endsAt: true, trainingType: { select: { name: true } }, dayClosures: placed } },
        },
      }),
      this.prisma.tournamentRegistration.findMany({
        where: { ...open, tournament: { endsAt: window } },
        select: {
          id: true,
          clientId: true,
          tournamentId: true,
          reminderSentAt: true,
          status: true,
          tournament: {
            select: { startsAt: true, endsAt: true, tournamentType: { select: { name: true } }, dayClosures: placed },
          },
        },
      }),
    ]);

    const groups = new Map<string, PendingGroup>();
    const add = (key: string, make: () => PendingGroup, entryId: string, ownerId: string | null) => {
      const group = groups.get(key) ?? make();
      group.entryIds.push(entryId);

      if (ownerId) {
        group.ownerIds.push(ownerId);
      }

      groups.set(key, group);
    };

    // Правило решает ещё раз: ошибка в запросе — это напоминание о записи,
    // которую джоба уже закрыла или ещё рано трогать.
    for (const row of tables) {
      if (!escalationDue(row, policy, now)) continue;

      add(`TABLE:${row.id}`, () => ({
        kind: 'TABLE',
        groupId: row.id,
        entryIds: [],
        ownerIds: [],
        title: `${row.isSparring ? 'спарринг, ' : ''}${row.table.label}`,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        place: row.table.hall.name,
        timezone: row.table.hall.timezone,
      }), row.id, row.clientId ?? row.coachId);
    }

    for (const row of trainings) {
      if (!escalationDue({ ...row, endsAt: row.session.endsAt }, policy, now)) continue;

      const where = row.session.dayClosures[0]?.schedule.hall;
      add(`TRAINING:${row.sessionId}`, () => ({
        kind: 'TRAINING',
        groupId: row.sessionId,
        entryIds: [],
        ownerIds: [],
        title: row.session.trainingType.name,
        startsAt: row.session.startsAt,
        endsAt: row.session.endsAt,
        place: where?.name ?? null,
        timezone: where?.timezone ?? fallback,
      }), row.id, row.clientId);
    }

    for (const row of tournaments) {
      if (!escalationDue({ ...row, endsAt: row.tournament.endsAt }, policy, now)) continue;

      const where = row.tournament.dayClosures[0]?.schedule.hall;
      add(`TOURNAMENT:${row.tournamentId}`, () => ({
        kind: 'TOURNAMENT',
        groupId: row.tournamentId,
        entryIds: [],
        ownerIds: [],
        title: row.tournament.tournamentType.name,
        startsAt: row.tournament.startsAt,
        endsAt: row.tournament.endsAt,
        place: where?.name ?? null,
        timezone: where?.timezone ?? fallback,
      }), row.id, row.clientId);
    }

    return [...groups.values()];
  }

  /** Тренеру в 08:00 — его занятия на сегодня в этом клубе. Нет занятий — нет сообщения. */
  private async coachPlan(tenantId: string, coachId: string, now: Date): Promise<number> {
    const timezone = await clubTimezone(this.prisma, tenantId);
    const clock = zoneClock(timezone);
    const date = morningDue(now, clock);

    if (!date) {
      return 0;
    }

    const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const sessions = await this.prisma.trainingSession.findMany({
      where: { tenantId, coachId, startsAt: { gte: clock.instant(date, 0), lt: clock.instant(next, 0) } },
      select: {
        startsAt: true,
        capacity: true,
        trainingType: { select: { name: true } },
        _count: { select: { bookings: { where: { status: BookingStatus.BOOKED } } } },
      },
      orderBy: { startsAt: 'asc' },
    });

    if (sessions.length === 0) {
      return 0;
    }

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, slug: true } });
    const payload: CoachDayPayload = {
      club: tenant.name,
      slug: tenant.slug,
      timezone,
      sessions: sessions.map((session) => ({
        startsAt: session.startsAt.toISOString(),
        title: session.trainingType.name,
        booked: session._count.bookings,
        capacity: session.capacity,
      })),
    };

    return this.staff.notify(this.prisma, {
      userId: coachId,
      tenantId,
      type: 'COACH_DAY_PLAN',
      payload,
      dedupeKey: `coach-day:${tenantId}:${date}`,
    });
  }
}

/** Пометить записи напомненными — только те, что ещё не помечены. */
async function markReminded(
  tx: Prisma.TransactionClient,
  kind: EntryKind,
  ids: string[],
  now: Date,
): Promise<number> {
  const where = { id: { in: ids }, status: BookingStatus.BOOKED, reminderSentAt: null };
  const data = { reminderSentAt: now };

  switch (kind) {
    case 'TABLE':
      return (await tx.tableBooking.updateMany({ where, data })).count;
    case 'TRAINING':
      return (await tx.trainingBooking.updateMany({ where, data })).count;
    case 'TOURNAMENT':
      return (await tx.tournamentRegistration.updateMany({ where, data })).count;
  }
}
