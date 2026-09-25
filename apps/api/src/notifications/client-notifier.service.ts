import { Injectable } from '@nestjs/common';
import { BookingStatus, GuardianshipStatus, type NotificationType, type Prisma } from '@yenisey/database';
import { RANK_LABELS, shortName, type SportRankLevel } from '@yenisey/types';
import { cancellationPercent } from '../booking/availability';
import { chargeOf } from '../desk/revenue';
import { guardianHasRights } from '../guardianship/guardianship-rules';
import { PrismaService } from '../prisma/prisma.service';
import { clubTimezone, FALLBACK_TIMEZONE, zoneClock } from './clock';
import { clientRecipients, sendAfterFor } from './notification-rules';
import { NotificationsService, type NotificationDraft } from './notifications.service';
import type { EntryKind, EntryPayload, GuardianshipPayload, RankPayload, SubscriptionPayload } from './render';

type Db = Prisma.TransactionClient | PrismaService;

/** Кто вызвал событие: сам клиент (или его родитель) — или клуб. */
export type Origin = 'self' | 'club';

/** Запись в том объёме, в каком её читают сообщения. */
export interface EntryFacts {
  kind: EntryKind;
  id: string;
  tenantId: string;
  /** Пусто у спарринга: бронь тренера, и сообщать о ней клиенту некому. */
  clientId: string | null;
  status: BookingStatus;
  startsAt: Date;
  createdAt: Date;
  chargeRatio: number | null;
  price: number;
  prepaid: boolean;
  title: string;
  place: string | null;
  timezone: string;
  club: string;
}

/**
 * Сообщения клиенту о его записях, абонементе, разряде и семье.
 *
 * Каждый метод зовётся ВНУТРИ транзакции события — одной строкой, — и сам
 * решает, кому и что: клиенту, а ребёнку до 14 ещё и родителю, который за него
 * записывает. Текст соберёт отправщик (render.ts), а здесь собираются данные
 * для него и деньги — тем же `chargeOf`, что итог дня на смене.
 */
@Injectable()
export class ClientNotifier {
  constructor(private readonly notifications: NotificationsService) {}

  /** Запись создана: клиентом, родителем или администратором. */
  async entryBooked(db: Db, tenantId: string, kind: EntryKind, entryId: string, origin: Origin): Promise<void> {
    const facts = await loadEntry(db, tenantId, kind, entryId);

    // Бронь, заведённая администратором задним числом, — уже «пришёл»:
    // подтверждать прошедшее незачем.
    if (!facts || facts.status !== BookingStatus.BOOKED) {
      return;
    }

    await this.toClient(db, facts, 'BOOKING_CONFIRMED', `confirmed:${kind}:${entryId}`, origin, {
      byClub: origin === 'club',
    });
  }

  /** Запись отменена — клиентом или клубом. Процент уже записан в строку. */
  async entryCancelled(db: Db, tenantId: string, kind: EntryKind, entryId: string, origin: Origin): Promise<void> {
    const facts = await loadEntry(db, tenantId, kind, entryId);

    if (!facts || facts.status !== BookingStatus.CANCELLED) {
      return;
    }

    await this.toClient(db, facts, 'BOOKING_CANCELLED', `cancelled:${kind}:${entryId}`, origin, {
      byClub: origin === 'club',
      charge: chargeOf({ status: 'CANCELLED', price: facts.price, chargeRatio: facts.chargeRatio, prepaid: facts.prepaid }),
      chargePercent: facts.chargeRatio,
    });
  }

  /**
   * Отмечена неявка — администратором или джобой.
   *
   * Ключ с моментом: неявку можно исправить на «пришёл» и поставить снова, и
   * о второй человек тоже должен узнать.
   */
  async entryNoShow(db: Db, tenantId: string, kind: EntryKind, entryId: string, now: Date): Promise<void> {
    const facts = await loadEntry(db, tenantId, kind, entryId);

    if (!facts || facts.status !== BookingStatus.NO_SHOW) {
      return;
    }

    await this.toClient(db, facts, 'BOOKING_NO_SHOW', `no-show:${kind}:${entryId}:${now.getTime()}`, 'club', {
      charge: chargeOf({ status: 'NO_SHOW', price: facts.price, chargeRatio: facts.chargeRatio, prepaid: facts.prepaid }),
      chargePercent: facts.chargeRatio,
    }, now);
  }

  /**
   * Напоминание о записи. Зовёт планировщик, когда `reminderDue`.
   *
   * В ключе — начало записи: перенесённая администратором бронь получит новое
   * напоминание, а не останется со старым.
   */
  async entryReminder(db: Db, facts: EntryFacts, now: Date): Promise<number> {
    const tiers = await db.cancellationTier.findMany({
      where: { tenantId: facts.tenantId },
      select: { minMinutesBeforeStart: true, chargePercent: true },
    });

    return this.toClient(
      db,
      facts,
      'BOOKING_REMINDER',
      `reminder:${facts.kind}:${facts.id}:${facts.startsAt.getTime()}`,
      'club',
      { freeCancelUntil: freeCancelUntil(facts.startsAt, tiers)?.toISOString() ?? null },
      now,
      // Момент напоминания выбран с оглядкой на тихие часы заранее.
      false,
    );
  }

  /**
   * Абонемент кончается: по сроку, остался последний визит или визиты кончились.
   * Зовёт планировщик; ключ — причина и абонемент, так что каждое — один раз.
   */
  async subscriptionEnding(
    db: Db,
    sub: {
      id: string;
      tenantId: string;
      clientId: string;
      plan: string;
      club: string;
      timezone: string;
      expiresAt: Date | null;
      remainingVisits: number | null;
    },
    reason: SubscriptionPayload['reason'],
    now: Date,
  ): Promise<number> {
    const recipients = await this.recipientsOf(db, sub.clientId, now);

    const drafts: NotificationDraft[] = recipients.map((recipient) => {
      const payload: SubscriptionPayload = {
        reason,
        plan: sub.plan,
        club: sub.club,
        timezone: sub.timezone,
        person: recipient.person,
        expiresAt: sub.expiresAt?.toISOString() ?? null,
        remainingVisits: sub.remainingVisits,
      };

      return {
        userId: recipient.userId,
        tenantId: sub.tenantId,
        type: 'SUBSCRIPTION_ENDING',
        payload: payload as unknown as Prisma.InputJsonValue,
        dedupeKey: `subscription:${reason}:${sub.id}`,
        sendAfter: sendAfterFor(now, zoneClock(sub.timezone), false),
      };
    });

    return this.notifications.enqueue(db, drafts);
  }

  /** Клуб принял решение по разряду игрока. */
  async rankDecided(db: Db, tenantId: string, playerId: string): Promise<void> {
    const [rank, tenant] = await Promise.all([
      db.sportRank.findUnique({ where: { userId: playerId }, select: { rank: true, status: true, rejectionReason: true, updatedAt: true } }),
      db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } }),
    ]);

    if (!rank || (rank.status !== 'VERIFIED' && rank.status !== 'REJECTED')) {
      return;
    }

    const payload: RankPayload = {
      decision: rank.status,
      rank: RANK_LABELS[rank.rank as SportRankLevel],
      club: tenant.name,
      reason: rank.rejectionReason,
    };

    await this.notifications.enqueue(db, [
      {
        userId: playerId,
        tenantId,
        type: 'RANK_DECIDED',
        payload: payload as unknown as Prisma.InputJsonValue,
        dedupeKey: `rank:${rank.updatedAt.getTime()}`,
        sendAfter: sendAfterFor(new Date(), zoneClock(await clubTimezone(db, tenantId)), false),
      },
    ]);
  }

  /** Родитель просит закрепить ребёнка: ответить может только сам ребёнок. */
  async guardianshipRequested(db: Db, guardianshipId: string): Promise<void> {
    const request = await db.guardianship.findUnique({
      where: { id: guardianshipId },
      select: { childUserId: true, guardian: { select: { fullName: true } } },
    });

    if (!request) {
      return;
    }

    const payload: GuardianshipPayload = { guardian: shortName(request.guardian.fullName) };

    await this.notifications.enqueue(db, [
      {
        userId: request.childUserId,
        type: 'GUARDIANSHIP_REQUESTED',
        payload: payload as unknown as Prisma.InputJsonValue,
        dedupeKey: `guardianship:${guardianshipId}`,
      },
    ]);
  }

  /**
   * Сообщение о записи — клиенту и родителю, если тот ведёт ребёнка.
   *
   * Родителю в тексте — имя ребёнка: у родителя может быть двое детей в одной
   * группе. Возвращает, сколько строк встало.
   */
  private async toClient(
    db: Db,
    facts: EntryFacts,
    type: NotificationType,
    dedupeKey: string,
    origin: Origin,
    extra: Partial<EntryPayload>,
    now = new Date(),
    respectQuiet = true,
  ): Promise<number> {
    if (!facts.clientId) {
      return 0;
    }

    const recipients = await this.recipientsOf(db, facts.clientId, now);
    const clock = zoneClock(facts.timezone);
    const base: EntryPayload = {
      entry: { kind: facts.kind, id: facts.id, startsAt: facts.startsAt.toISOString() },
      title: facts.title,
      place: facts.place,
      club: facts.club,
      timezone: facts.timezone,
      person: null,
      prepaid: facts.prepaid,
      price: facts.price,
      ...extra,
    };

    const drafts: NotificationDraft[] = recipients.map((recipient) => ({
      userId: recipient.userId,
      tenantId: facts.tenantId,
      type,
      payload: { ...base, person: recipient.person } as unknown as Prisma.InputJsonValue,
      dedupeKey,
      sendAfter: respectQuiet ? sendAfterFor(now, clock, origin === 'self') : undefined,
    }));

    return this.notifications.enqueue(db, drafts);
  }

  /**
   * Клиент и родитель, который его ведёт. Родителю в тексте — имя ребёнка:
   * у родителя может быть двое детей в одной группе.
   */
  private async recipientsOf(db: Db, clientId: string, now: Date): Promise<{ userId: string; person: string | null }[]> {
    const [client, guardians] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: clientId }, select: { fullName: true, birthDate: true } }),
      db.guardianship.findMany({
        where: { childUserId: clientId, status: GuardianshipStatus.ACTIVE },
        select: { guardianUserId: true, status: true },
      }),
    ]);

    const ids = clientRecipients(
      clientId,
      guardians.map((row) => ({ ...row, childBirthDate: client.birthDate })),
      (link) => guardianHasRights(link.status as GuardianshipStatus, link.childBirthDate, now),
    );

    return ids.map((userId) => ({ userId, person: userId === clientId ? null : shortName(client.fullName) }));
  }
}

/**
 * Не устарело ли сообщение, пока ждало очереди.
 *
 * Напоминание о записи, которую отменили или перенесли, отправлять нельзя:
 * «через три часа занятие» об отменённом занятии — хуже тишины. Остальное
 * — факты, которые уже случились, и они не устаревают.
 */
export async function stillRelevant(
  db: Db,
  row: { type: string; payload: unknown; tenantId: string | null },
): Promise<boolean> {
  if (row.type !== 'BOOKING_REMINDER') {
    return true;
  }

  const entry = (row.payload as Partial<EntryPayload> | null)?.entry;

  if (!entry || !row.tenantId) {
    return false;
  }

  const facts = await loadEntry(db, row.tenantId, entry.kind, entry.id);

  return facts !== null && facts.status === BookingStatus.BOOKED && facts.startsAt.toISOString() === entry.startsAt;
}

/**
 * До какого момента отмена бесплатна — последний порог политики, за которым
 * процент ещё ноль. Нет такого порога (клуб берёт деньги за любую отмену) —
 * null, и напоминание о бесплатной отмене молчит.
 */
function freeCancelUntil(startsAt: Date, tiers: readonly { minMinutesBeforeStart: number; chargePercent: number }[]): Date | null {
  const free = tiers
    .filter((tier) => tier.chargePercent === 0)
    .map((tier) => tier.minMinutesBeforeStart)
    .sort((a, b) => a - b)[0];

  if (free === undefined || cancellationPercent(tiers, free) !== 0) {
    return null;
  }

  return new Date(startsAt.getTime() - free * 60_000);
}

const HALL = { select: { name: true, timezone: true } } as const;

/**
 * Запись со всем, что нужно для сообщения.
 *
 * Занятие и турнир зала не несут: зал находится через окно расписания дня,
 * где мероприятие стоит, а если его там нет — берётся старший зал клуба,
 * ради пояса.
 */
export async function loadEntry(db: Db, tenantId: string, kind: EntryKind, id: string): Promise<EntryFacts | null> {
  const common = { tenant: { select: { name: true, halls: { ...HALL, orderBy: { createdAt: 'asc' as const }, take: 1 } } } };
  const placed = { take: 1, select: { schedule: { select: { hall: HALL } } } } as const;

  switch (kind) {
    case 'TABLE': {
      const row = await db.tableBooking.findFirst({
        where: { id, tenantId },
        select: {
          clientId: true,
          status: true,
          startsAt: true,
          createdAt: true,
          chargeRatio: true,
          priceAtBooking: true,
          table: { select: { label: true, hall: HALL } },
          ...common,
        },
      });

      return row
        ? {
            kind,
            id,
            tenantId,
            clientId: row.clientId,
            status: row.status,
            startsAt: row.startsAt,
            createdAt: row.createdAt,
            chargeRatio: row.chargeRatio,
            price: row.priceAtBooking,
            prepaid: false,
            title: row.table.label,
            place: row.table.hall.name,
            timezone: row.table.hall.timezone,
            club: row.tenant.name,
          }
        : null;
    }

    case 'TRAINING': {
      const row = await db.trainingBooking.findFirst({
        where: { id, tenantId },
        select: {
          clientId: true,
          status: true,
          createdAt: true,
          chargeRatio: true,
          priceAtBooking: true,
          subscriptionId: true,
          session: { select: { startsAt: true, trainingType: { select: { name: true } }, dayClosures: placed } },
          ...common,
        },
      });

      if (!row) {
        return null;
      }

      const hall = row.session.dayClosures[0]?.schedule.hall ?? row.tenant.halls[0] ?? null;

      return {
        kind,
        id,
        tenantId,
        clientId: row.clientId,
        status: row.status,
        startsAt: row.session.startsAt,
        createdAt: row.createdAt,
        chargeRatio: row.chargeRatio,
        price: row.priceAtBooking,
        prepaid: row.subscriptionId !== null,
        title: row.session.trainingType.name,
        place: row.session.dayClosures[0]?.schedule.hall.name ?? null,
        timezone: hall?.timezone ?? FALLBACK_TIMEZONE,
        club: row.tenant.name,
      };
    }

    case 'TOURNAMENT': {
      const row = await db.tournamentRegistration.findFirst({
        where: { id, tenantId },
        select: {
          clientId: true,
          status: true,
          createdAt: true,
          chargeRatio: true,
          priceAtBooking: true,
          subscriptionId: true,
          tournament: { select: { startsAt: true, tournamentType: { select: { name: true } }, dayClosures: placed } },
          ...common,
        },
      });

      if (!row) {
        return null;
      }

      const hall = row.tournament.dayClosures[0]?.schedule.hall ?? row.tenant.halls[0] ?? null;

      return {
        kind,
        id,
        tenantId,
        clientId: row.clientId,
        status: row.status,
        startsAt: row.tournament.startsAt,
        createdAt: row.createdAt,
        chargeRatio: row.chargeRatio,
        price: row.priceAtBooking,
        prepaid: row.subscriptionId !== null,
        title: row.tournament.tournamentType.name,
        place: row.tournament.dayClosures[0]?.schedule.hall.name ?? null,
        timezone: hall?.timezone ?? FALLBACK_TIMEZONE,
        club: row.tenant.name,
      };
    }
  }
}
