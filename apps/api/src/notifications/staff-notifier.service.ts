import { Injectable } from '@nestjs/common';
import { BookingStatus, Role, type NotificationType, type Prisma } from '@yenisey/database';
import { RANK_LABELS, shortName, type SportRankLevel } from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';
import { clubTimezone, zoneClock } from './clock';
import { sendAfterFor } from './notification-rules';
import { NotificationsService } from './notifications.service';
import type { AutoNoShowPayload, CoachEntryPayload, RankPendingPayload } from './render';

type Db = Prisma.TransactionClient | PrismaService;

/**
 * Сообщения персоналу клуба: тренеру — о его группах, администраторам и
 * руководству — о том, что ждёт решения клуба.
 *
 * Как и ClientNotifier, зовётся одной строкой внутри транзакции события. О
 * клиенте персоналу — только сокращённое имя: полное и телефон — на экране
 * сайта по ссылке из сообщения.
 *
 * Ночью ничего не будит: у персонала сообщение никогда не реакция на его
 * собственное действие, и тихие часы соблюдаются всегда.
 */
@Injectable()
export class StaffNotifier {
  constructor(private readonly notifications: NotificationsService) {}

  /**
   * Тренеру: запись или отмена в его группе (ТЗ: «уведомления о
   * записях/отменах»). С числом «записано N из M» — ради него тренер и
   * открывает сообщение.
   */
  async trainingChanged(
    db: Db,
    tenantId: string,
    bookingId: string,
    change: CoachEntryPayload['change'],
    now = new Date(),
  ): Promise<void> {
    const booking = await db.trainingBooking.findFirst({
      where: { id: bookingId, tenantId },
      select: {
        client: { select: { membership: { select: { user: { select: { fullName: true } } } } } },
        session: {
          select: {
            id: true,
            coachId: true,
            startsAt: true,
            capacity: true,
            trainingType: { select: { name: true } },
            dayClosures: { take: 1, select: { schedule: { select: { hall: { select: { timezone: true } } } } } },
          },
        },
        tenant: { select: { name: true, slug: true } },
      },
    });

    if (!booking) {
      return;
    }

    const { session } = booking;
    const booked = await db.trainingBooking.count({ where: { sessionId: session.id, status: BookingStatus.BOOKED } });
    const timezone =
      session.dayClosures[0]?.schedule.hall.timezone ?? (await clubTimezone(db, tenantId));

    const payload: CoachEntryPayload = {
      change,
      person: shortName(booking.client.membership.user.fullName),
      title: session.trainingType.name,
      startsAt: session.startsAt.toISOString(),
      timezone,
      club: booking.tenant.name,
      slug: booking.tenant.slug,
      booked,
      capacity: session.capacity,
    };

    await this.notifications.enqueue(db, [
      {
        userId: session.coachId,
        tenantId,
        type: 'COACH_ENTRY_CHANGED',
        payload: payload as unknown as Prisma.InputJsonValue,
        dedupeKey: `coach:${change}:${bookingId}`,
        sendAfter: sendAfterFor(now, zoneClock(timezone), false),
      },
    ]);
  }

  /**
   * Игрок заявил или поправил разряд — администраторам всех его клубов:
   * проверить может любой из них, и первый решивший закрывает вопрос.
   */
  async rankPending(db: Db, playerId: string, now = new Date()): Promise<void> {
    const [player, rank, memberships] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: playerId }, select: { fullName: true } }),
      db.sportRank.findUnique({ where: { userId: playerId }, select: { rank: true, status: true, updatedAt: true } }),
      db.tenantMembership.findMany({
        where: { userId: playerId, deactivatedAt: null },
        select: { tenant: { select: { id: true, name: true, slug: true } } },
      }),
    ]);

    if (!rank || rank.status !== 'PENDING') {
      return;
    }

    for (const { tenant } of memberships) {
      const payload: RankPendingPayload = {
        person: shortName(player.fullName),
        personId: playerId,
        rank: RANK_LABELS[rank.rank as SportRankLevel],
        club: tenant.name,
        slug: tenant.slug,
      };

      await this.toStaff(db, tenant.id, 'RANK_PENDING', payload, `rank-pending:${tenant.id}:${playerId}:${rank.updatedAt.getTime()}`, now, [playerId]);
    }
  }

  /**
   * Итог прохода автонеявки по клубу — одно сообщение, а не по записи.
   * `ownerIds` — чья каждая закрытая запись: клиент или тренер спарринга.
   */
  async autoNoShows(db: Db, tenantId: string, ownerIds: readonly string[], now: Date): Promise<void> {
    if (ownerIds.length === 0) {
      return;
    }

    const [tenant, users] = await Promise.all([
      db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, slug: true } }),
      db.user.findMany({ where: { id: { in: [...new Set(ownerIds)] } }, select: { id: true, fullName: true } }),
    ]);
    const nameOf = new Map(users.map((user) => [user.id, shortName(user.fullName)]));

    const payload: AutoNoShowPayload = {
      club: tenant.name,
      slug: tenant.slug,
      people: ownerIds.map((id) => nameOf.get(id) ?? '—').sort((a, b) => a.localeCompare(b, 'ru')),
      count: ownerIds.length,
    };

    await this.toStaff(db, tenantId, 'ATTENDANCE_AUTO_NO_SHOW', payload, `auto-no-show:${tenantId}:${now.getTime()}`, now);
  }

  /**
   * Одному человеку из персонала — тренеру его план. Без тихих часов: зовётся
   * утром, когда они уже кончились.
   */
  notify(
    db: Db,
    draft: { userId: string; tenantId: string; type: NotificationType; payload: object; dedupeKey: string },
  ): Promise<number> {
    return this.notifications.enqueue(db, [{ ...draft, payload: draft.payload as Prisma.InputJsonValue }]);
  }

  /**
   * Администраторам и руководству клуба — с действующим членством.
   *
   * Ключ идемпотентности обязан нести клуб: администратор двух клубов иначе
   * получил бы сообщение только от первого — второе упёрлось бы в ключ.
   *
   * `except` — те, кого сообщение касается сами: администратор, заявивший
   * свой разряд, о нём и так знает (а подтвердить свой разряд ему не даст
   * база).
   *
   * Новых людей в клубе и абонементы клиентов здесь нет намеренно: их
   * администраторы видят в утренней сводке, а не отдельными сообщениями
   * (решение владельца от 24.09.2026).
   */
  async toStaff(
    db: Db,
    tenantId: string,
    type: NotificationType,
    payload: object,
    dedupeKey: string,
    now: Date,
    except: readonly string[] = [],
    timezone?: string,
  ): Promise<number> {
    const staff = await clubStaff(db, tenantId);
    const clock = zoneClock(timezone ?? (await clubTimezone(db, tenantId)));

    return this.notifications.enqueue(
      db,
      staff
        .filter((userId) => !except.includes(userId))
        .map((userId) => ({
          userId,
          tenantId,
          type,
          payload: payload as Prisma.InputJsonValue,
          dedupeKey,
          sendAfter: sendAfterFor(now, clock, false),
        })),
    );
  }
}

/** Администраторы и руководство клуба, которые в нём ещё работают. */
export async function clubStaff(db: Db, tenantId: string): Promise<string[]> {
  const rows = await db.tenantMembership.findMany({
    where: {
      tenantId,
      role: { in: [Role.ADMIN, Role.OWNER] },
      deactivatedAt: null,
      user: { deactivatedAt: null },
    },
    select: { userId: true },
  });

  return rows.map((row) => row.userId);
}
