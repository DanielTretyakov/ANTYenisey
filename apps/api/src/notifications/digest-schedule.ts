import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookingStatus, NotificationStatus, PlatformRole, Role, type Prisma } from '@yenisey/database';
import { shortName } from '@yenisey/types';
import type { Env } from '../config/env';
import { moneyOf } from '../desk/revenue';
import { PrismaService } from '../prisma/prisma.service';
import { clubTimezone, zoneClock } from './clock';
import { DIGEST_MINUTE, morningDue, shiftDate, type LocalClock } from './notification-rules';
import { NotificationsService, reachableUserIds } from './notifications.service';
import type { ClubDigestPayload, PlatformDigestPayload } from './render';
import { clubStaff } from './staff-notifier.service';

/** За сколько дней до конца срока показывать абонемент в сводке. */
const EXPIRY_NOTICE_DAYS = 3;

/** Сколько имён класть в сводку: дальше текст скажет «и ещё N». */
const NAMES_KEPT = 10;

const DAY_MS = 86_400_000;

/** Сутки по местному времени: [начало, конец). */
interface Day {
  date: string;
  from: Date;
  to: Date;
}

function dayOf(date: string, clock: LocalClock): Day {
  return { date, from: clock.instant(date, 0), to: clock.instant(shiftDate(date, 1), 0) };
}

/**
 * Утренние сводки: руководству клуба — в 09:00 по поясу клуба, владельцу
 * платформы — в 09:00 по PLATFORM_TIMEZONE. Часть NotificationScheduler.
 *
 * Сводка — за вчерашние местные сутки. Ключ идемпотентности — дата, так что
 * утро даёт одну сводку, сколько бы проходов ни сделал планировщик.
 *
 * В сводку клуба сведено всё, о чём администратору не пишут отдельно
 * (решение владельца от 24.09.2026): кто отметил клуб своим, новые клиенты,
 * у кого кончаются абонементы. Деньги дня — тем же `moneyOf`, что на экране
 * смены: второй расчёт разошёлся бы с первым молча.
 */
@Injectable()
export class DigestSchedule {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async runOnce(now: Date): Promise<{ clubDigests: number; platformDigests: number }> {
    const linked = await reachableUserIds(this.prisma);

    if (linked.length === 0) {
      return { clubDigests: 0, platformDigests: 0 };
    }

    const tenants = await this.prisma.tenantMembership.findMany({
      where: { userId: { in: linked }, deactivatedAt: null, roles: { hasSome: [Role.ADMIN, Role.MANAGER, Role.OWNER] } },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });

    let clubDigests = 0;

    for (const { tenantId } of tenants) {
      clubDigests += await this.clubDigest(tenantId, now);
    }

    return { clubDigests, platformDigests: await this.platformDigest(linked, now) };
  }

  private async clubDigest(tenantId: string, now: Date): Promise<number> {
    const timezone = await clubTimezone(this.prisma, tenantId);
    const clock = zoneClock(timezone);
    const today = morningDue(now, clock, DIGEST_MINUTE);

    if (!today) {
      return 0;
    }

    const staff = await clubStaff(this.prisma, tenantId);
    const payload = await this.clubNumbers(tenantId, dayOf(shiftDate(today, -1), clock), dayOf(today, clock), timezone, now);

    return this.notifications.enqueue(
      this.prisma,
      staff.map((userId) => ({
        userId,
        tenantId,
        type: 'CLUB_DIGEST' as const,
        payload: payload as unknown as Prisma.InputJsonValue,
        dedupeKey: `digest:club:${tenantId}:${today}`,
      })),
    );
  }

  /** Цифры клуба. Открыто ради проверок: сводку можно собрать за любой день. */
  async clubNumbers(tenantId: string, yesterday: Day, today: Day, timezone: string, now: Date): Promise<ClubDigestPayload> {
    const db = this.prisma;
    const window = { gte: yesterday.from, lt: yesterday.to };
    const todayWindow = { gte: today.from, lt: today.to };
    const name = { user: { select: { fullName: true } } } as const;
    const person = { client: { select: { membership: { select: name } } } } as const;

    const [tenant, favourites, favouritesTotal, newClients, tables, trainings, tournaments, sales] = await Promise.all([
      db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, slug: true, attendanceTrackedSince: true } }),
      db.userClub.findMany({ where: { tenantId, createdAt: window }, select: name, orderBy: { createdAt: 'asc' } }),
      db.userClub.count({ where: { tenantId } }),
      db.tenantMembership.findMany({
        where: { tenantId, roles: { has: Role.CLIENT }, createdAt: window },
        select: name,
        orderBy: { createdAt: 'asc' },
      }),
      db.tableBooking.findMany({ where: { tenantId, startsAt: window }, select: { status: true, priceAtBooking: true, chargeRatio: true } }),
      db.trainingBooking.findMany({
        where: { tenantId, session: { startsAt: window } },
        select: { status: true, priceAtBooking: true, chargeRatio: true, subscriptionId: true },
      }),
      db.tournamentRegistration.findMany({
        where: { tenantId, tournament: { startsAt: window } },
        select: { status: true, priceAtBooking: true, chargeRatio: true, subscriptionId: true },
      }),
      db.subscription.aggregate({ where: { tenantId, purchasedAt: window }, _count: true, _sum: { priceAtPurchase: true } }),
    ]);

    const charge = (row: { status: BookingStatus; priceAtBooking: number; chargeRatio: number | null; subscriptionId?: string | null }) => ({
      status: row.status,
      price: row.priceAtBooking,
      chargeRatio: row.chargeRatio,
      prepaid: Boolean(row.subscriptionId),
    });
    const all = [...tables, ...trainings, ...tournaments];
    const money = moneyOf({ tables: tables.map(charge), trainings: trainings.map(charge), tournaments: tournaments.map(charge) });

    const [unmarked, todaySessions, todayTournaments, todayTables, expiring, empty] = await Promise.all([
      this.unmarked(tenantId, tenant.attendanceTrackedSince, now),
      db.trainingSession.findMany({
        where: { tenantId, startsAt: todayWindow },
        select: { capacity: true, _count: { select: { bookings: { where: { status: BookingStatus.BOOKED } } } } },
      }),
      db.tournament.count({ where: { tenantId, startsAt: todayWindow } }),
      db.tableBooking.count({ where: { tenantId, startsAt: todayWindow, status: BookingStatus.BOOKED } }),
      db.subscription.findMany({
        where: {
          tenantId,
          expiresAt: { gt: now, lte: new Date(now.getTime() + EXPIRY_NOTICE_DAYS * DAY_MS) },
          OR: [{ remainingVisits: null }, { remainingVisits: { gt: 0 } }],
        },
        select: { expiresAt: true, plan: { select: { name: true } }, ...person },
        orderBy: { expiresAt: 'asc' },
      }),
      // Визиты кончились за вчерашние сутки: последняя строка журнала — вчера.
      db.subscription.findMany({
        where: {
          tenantId,
          remainingVisits: 0,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          ledger: { some: { createdAt: window } },
        },
        select: { plan: { select: { name: true } }, ...person },
      }),
    ]);

    return {
      club: tenant.name,
      slug: tenant.slug,
      timezone,
      date: yesterday.date,
      favourites: {
        count: favourites.length,
        total: favouritesTotal,
        people: favourites.slice(0, NAMES_KEPT).map((row) => shortName(row.user.fullName)),
      },
      newClients: {
        count: newClients.length,
        people: newClients.slice(0, NAMES_KEPT).map((row) => shortName(row.user.fullName)),
      },
      yesterday: {
        attended: all.filter((row) => row.status === BookingStatus.ATTENDED).length,
        noShows: all.filter((row) => row.status === BookingStatus.NO_SHOW).length,
        cancelled: all.filter((row) => row.status === BookingStatus.CANCELLED).length,
        money: money.total,
        subscriptionSales: { count: sales._count, amount: sales._sum.priceAtPurchase ?? 0 },
      },
      unmarked,
      today: {
        trainings: todaySessions.length,
        booked: todaySessions.reduce((sum, row) => sum + row._count.bookings, 0),
        capacity: todaySessions.reduce((sum, row) => sum + row.capacity, 0),
        tournaments: todayTournaments,
        tables: todayTables,
      },
      subscriptions: {
        expiring: expiring.slice(0, NAMES_KEPT).map((row) => ({
          person: shortName(row.client.membership.user.fullName),
          plan: row.plan.name,
          expiresAt: row.expiresAt!.toISOString(),
        })),
        empty: empty.slice(0, NAMES_KEPT).map((row) => ({
          person: shortName(row.client.membership.user.fullName),
          plan: row.plan.name,
        })),
      },
    };
  }

  /** Прошедшие записи без отметки — из учётного окна клуба. */
  private async unmarked(tenantId: string, since: Date, now: Date): Promise<number> {
    const open = { tenantId, status: BookingStatus.BOOKED };
    const ended = { gte: since, lte: now };

    const counts = await Promise.all([
      this.prisma.tableBooking.count({ where: { ...open, endsAt: ended } }),
      this.prisma.trainingBooking.count({ where: { ...open, session: { endsAt: ended } } }),
      this.prisma.tournamentRegistration.count({ where: { ...open, tournament: { endsAt: ended } } }),
    ]);

    return counts.reduce((sum, count) => sum + count, 0);
  }

  private async platformDigest(linked: readonly string[], now: Date): Promise<number> {
    const owners = await this.prisma.user.findMany({
      where: { id: { in: [...linked] }, platformRole: PlatformRole.OWNER, deactivatedAt: null },
      select: { id: true },
    });

    if (owners.length === 0) {
      return 0;
    }

    const clock = zoneClock(this.config.get('PLATFORM_TIMEZONE', { infer: true }));
    const today = morningDue(now, clock, DIGEST_MINUTE);

    if (!today) {
      return 0;
    }

    const payload = await this.platformNumbers(dayOf(shiftDate(today, -1), clock), now);

    return this.notifications.enqueue(
      this.prisma,
      owners.map((owner) => ({
        userId: owner.id,
        type: 'PLATFORM_DIGEST' as const,
        payload: payload as unknown as Prisma.InputJsonValue,
        dedupeKey: `digest:platform:${today}`,
      })),
    );
  }

  private async platformNumbers(day: Day, now: Date): Promise<PlatformDigestPayload> {
    const db = this.prisma;
    const window = { gte: day.from, lt: day.to };
    const month = { gte: new Date(now.getTime() - 30 * DAY_MS) };
    const alive = { anonymizedAt: null, deactivatedAt: null };

    const [usersAdded, usersTotal, clubsAdded, clubsTotal, favourites, tables, trainings, tournaments, linked, blocked, failed] =
      await Promise.all([
        db.user.count({ where: { ...alive, createdAt: window } }),
        db.user.count({ where: alive }),
        db.tenant.count({ where: { createdAt: window } }),
        db.tenant.count(),
        db.userClub.groupBy({ by: ['tenantId'], where: { createdAt: window }, _count: true }),
        db.tableBooking.count({ where: { createdAt: window, clientId: { not: null } } }),
        db.trainingBooking.count({ where: { createdAt: window } }),
        db.tournamentRegistration.count({ where: { createdAt: window } }),
        db.maxLink.count({ where: { blockedAt: null } }),
        db.maxLink.count({ where: { blockedAt: { not: null } } }),
        db.notification.count({ where: { status: NotificationStatus.FAILED, createdAt: window } }),
      ]);

    // Активный клиент — у кого за 30 дней была хоть одна запись в любом клубе.
    const [activeTables, activeTrainings, activeTournaments] = await Promise.all([
      db.tableBooking.findMany({ where: { createdAt: month, clientId: { not: null } }, select: { clientId: true }, distinct: ['clientId'] }),
      db.trainingBooking.findMany({ where: { createdAt: month }, select: { clientId: true }, distinct: ['clientId'] }),
      db.tournamentRegistration.findMany({ where: { createdAt: month }, select: { clientId: true }, distinct: ['clientId'] }),
    ]);
    const active = new Set([...activeTables, ...activeTrainings, ...activeTournaments].map((row) => row.clientId));

    const clubNames = new Map(
      (await db.tenant.findMany({ where: { id: { in: favourites.map((row) => row.tenantId) } }, select: { id: true, name: true } })).map(
        (tenant) => [tenant.id, tenant.name],
      ),
    );

    return {
      date: day.date,
      users: { added: usersAdded, total: usersTotal },
      clubs: { added: clubsAdded, total: clubsTotal },
      favourites: {
        count: favourites.reduce((sum, row) => sum + row._count, 0),
        byClub: favourites
          .map((row) => ({ club: clubNames.get(row.tenantId) ?? '—', count: row._count }))
          .sort((a, b) => b.count - a.count),
      },
      entries: tables + trainings + tournaments,
      activeClients30: active.size,
      max: { linked, blocked, failed },
    };
  }
}
