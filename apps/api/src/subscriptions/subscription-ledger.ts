import type { LedgerReason, Prisma } from '@yenisey/database';

/** Абонемент под блокировкой — в том объёме, в каком его читают правила. */
export interface LockedSubscription {
  id: string;
  clientId: string;
  remainingVisits: number | null;
  expiresAt: Date | null;
}

/**
 * Взять абонемент под `FOR UPDATE`.
 *
 * Без блокировки две параллельные записи прочитали бы один и тот же остаток
 * «1», обе списали бы визит, и вторая увела бы баланс в минус — вернее,
 * упёрлась бы в CHECK и упала ошибкой 500 вместо честного «визитов нет».
 *
 * Порядок блокировок везде один: сначала строка записи или занятия, потом
 * абонемент. Обратный порядок в одном из путей дал бы взаимную блокировку.
 */
export async function lockSubscription(
  tx: Prisma.TransactionClient,
  tenantId: string,
  subscriptionId: string,
): Promise<LockedSubscription | null> {
  const rows = await tx.$queryRaw<LockedSubscription[]>`
    SELECT "id", "clientId", "remainingVisits", "expiresAt"
    FROM "Subscription"
    WHERE "id" = ${subscriptionId} AND "tenantId" = ${tenantId}
    FOR UPDATE`;

  return rows[0] ?? null;
}

export interface LedgerMove {
  tenantId: string;
  subscriptionId: string;
  delta: number;
  /** Остаток после движения; null у безлимита — тогда кэш не трогается. */
  balanceAfter: number | null;
  reason: LedgerReason;
  trainingBookingId?: string;
  tournamentRegistrationId?: string;
  createdByUserId?: string | null;
  note?: string | null;
}

/**
 * Записать движение по абонементу.
 *
 * ЕДИНСТВЕННОЕ место, которое пишет журнал и кэш `remainingVisits`. Схема
 * требует менять их вместе, в одной транзакции, — иначе спор «у меня было
 * десять визитов» разрешить нечем. Проверить это CHECK'ом нельзя (это
 * сравнение с суммой другой таблицы), поэтому правило держит одна функция.
 *
 * Вызывающий обязан держать абонемент под `lockSubscription` в той же
 * транзакции и посчитать `balanceAfter` от заблокированного остатка.
 */
export async function writeLedger(tx: Prisma.TransactionClient, move: LedgerMove): Promise<void> {
  await tx.subscriptionLedger.create({
    data: {
      tenantId: move.tenantId,
      subscriptionId: move.subscriptionId,
      delta: move.delta,
      balanceAfter: move.balanceAfter,
      reason: move.reason,
      trainingBookingId: move.trainingBookingId ?? null,
      tournamentRegistrationId: move.tournamentRegistrationId ?? null,
      createdByUserId: move.createdByUserId ?? null,
      note: move.note ?? null,
    },
  });

  if (move.balanceAfter !== null) {
    await tx.subscription.update({
      where: { id: move.subscriptionId },
      data: { remainingVisits: move.balanceAfter },
    });
  }
}
