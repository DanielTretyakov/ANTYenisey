import { ActorType, AuditAction, BookingStatus, type Prisma } from '@yenisey/database';
import type { ClientNotifier, ClubCancelNotice } from '../notifications/client-notifier.service';
import type { SubscriptionsService } from '../subscriptions/subscriptions.service';

/** Запись, которую отменяет клуб: аренда, занятие или турнир. */
export interface ClubCancelledEntry {
  kind: 'TABLE' | 'TRAINING' | 'TOURNAMENT';
  /** Строка записи, а не проведения. */
  id: string;
  subscriptionId: string | null;
}

export interface ClubCancelOptions {
  now: Date;
  /** Причина — в журнал аудита. */
  reason: string;
  /** Сотрудник; пусто — джоба (приостановка подписки). */
  actorUserId: string | null;
  /** Что сказать человеку: клуб приостановлен или отменено само проведение. */
  notice: ClubCancelNotice;
}

/**
 * Отмена записи КЛУБОМ — без денег: процент 0, визит абонемента вернулся,
 * строка аудита, сообщение человеку (и родителю ребёнка).
 *
 * Одна на два пути — приостановку подписки на КНТ (`BillingService`) и отмену
 * занятия или турнира (`EventCancellationService`): второй расчёт возврата
 * разошёлся бы с первым молча.
 *
 * Условным обновлением `WHERE status = BOOKED`: запись, которую в этот момент
 * отменил сам человек или отметил администратор, не трогается. Возвращает,
 * отменена ли она этим вызовом. Зовётся в транзакции вызывающего.
 */
export async function cancelEntryByClubInTx(
  tx: Prisma.TransactionClient,
  deps: { subscriptions: SubscriptionsService; clients: ClientNotifier },
  tenantId: string,
  entry: ClubCancelledEntry,
  options: ClubCancelOptions,
): Promise<boolean> {
  const data = { status: BookingStatus.CANCELLED, cancelledAt: options.now, chargeRatio: 0 };
  const where = { id: entry.id, status: BookingStatus.BOOKED };
  const updated =
    entry.kind === 'TABLE'
      ? await tx.tableBooking.updateMany({ where, data })
      : entry.kind === 'TRAINING'
        ? await tx.trainingBooking.updateMany({ where, data })
        : await tx.tournamentRegistration.updateMany({ where, data });

  if (updated.count === 0) return false;

  if (entry.subscriptionId) {
    await deps.subscriptions.settleInTx(tx, tenantId, entry.subscriptionId, true, false, linkOf(entry.kind, entry.id));
  }

  await tx.auditLog.create({
    data: {
      tenantId,
      action: AuditAction.BOOKING_CANCELLED,
      actorType: options.actorUserId ? ActorType.USER : ActorType.SYSTEM_JOB,
      actorUserId: options.actorUserId,
      entityType: ENTITY_TYPE[entry.kind],
      entityId: entry.id,
      before: { status: BookingStatus.BOOKED },
      after: { status: BookingStatus.CANCELLED, chargeRatio: 0 },
      reason: options.reason,
    },
  });

  await deps.clients.entryCancelled(tx, tenantId, entry.kind, entry.id, 'club', options.notice);

  return true;
}

const ENTITY_TYPE = { TABLE: 'TableBooking', TRAINING: 'TrainingBooking', TOURNAMENT: 'TournamentRegistration' } as const;

function linkOf(kind: ClubCancelledEntry['kind'], id: string) {
  return kind === 'TABLE' ? { tableBookingId: id } : kind === 'TRAINING' ? { trainingBookingId: id } : { tournamentRegistrationId: id };
}
