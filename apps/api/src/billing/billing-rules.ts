/**
 * Правила подписки клуба на КНТ (ТЗ → «Монетизация платформы», решения
 * владельца от 02.10.2026):
 *
 * - новый клуб — 7 дней пробного периода;
 * - за 7 и за 1 день до конца срока — напоминание руководителю;
 * - в конце срока — автосписание по сохранённой карте, если оно включено;
 * - не оплачено — PAST_DUE: клуб работает ещё 3 дня, списание повторяется
 *   раз в сутки;
 * - не оплачено и за 3 дня — SUSPENDED: доступ закрыт, все будущие записи
 *   клуба отменяются с полным возвратом.
 *
 * Чистый модуль без относительных импортов — его гоняет `node --test`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Льготные дни после неудачного списания — те же, что `PLATFORM_GRACE_DAYS`. */
export const GRACE_DAYS = 3;
/** Пробный период — тот же, что `PLATFORM_TRIAL_DAYS`. */
export const TRIAL_DAYS = 7;
/** Напоминания до конца срока, дней — от дальнего к ближнему. */
export const REMINDER_DAYS = [7, 1] as const;
/** Повтор неудачного автосписания — не чаще раза в сутки. */
export const RETRY_AFTER_MS = DAY_MS;

export type Status = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'EXEMPT';

/** То, что джоба знает о подписке клуба. */
export interface SubscriptionState {
  status: Status;
  trialEndsAt: Date | null;
  paidUntil: Date | null;
  autoRenew: boolean;
  /** Сохранённая карта есть — автосписание возможно. */
  hasCard: boolean;
  pastDueSince: Date | null;
  chargeAttempts: number;
  lastChargeAttemptAt: Date | null;
}

/** Что сделать с подпиской сейчас. Одно действие за проход — следующий проход увидит новое состояние. */
export type BillingStep =
  | { kind: 'none' }
  | { kind: 'remind'; days: number; endsAt: Date }
  | { kind: 'charge' }
  | { kind: 'past_due'; since: Date }
  | { kind: 'suspend' };

/** До какого момента клуб работает при просрочке. */
export function graceUntil(pastDueSince: Date): Date {
  return new Date(pastDueSince.getTime() + GRACE_DAYS * DAY_MS);
}

/** Конец срока, к которому относятся напоминания: пробный или оплаченный. */
function termEnd(state: SubscriptionState): Date | null {
  if (state.status === 'TRIAL') return state.trialEndsAt;
  if (state.status === 'ACTIVE') return state.paidUntil;
  return null;
}

/**
 * Решение о подписке на момент `now`.
 *
 * Порядок проверок — от последствий к предупреждениям: срок вышел — сначала
 * деньги или просрочка, а напоминание только пока он не вышел.
 */
export function billingStep(state: SubscriptionState, now: Date): BillingStep {
  const canCharge = state.autoRenew && state.hasCard;

  switch (state.status) {
    case 'EXEMPT':
    case 'SUSPENDED':
      return { kind: 'none' };

    case 'PAST_DUE': {
      const since = state.pastDueSince ?? now;

      if (now.getTime() >= graceUntil(since).getTime()) {
        return { kind: 'suspend' };
      }

      const retryDue =
        state.lastChargeAttemptAt === null || now.getTime() - state.lastChargeAttemptAt.getTime() >= RETRY_AFTER_MS;

      return canCharge && retryDue ? { kind: 'charge' } : { kind: 'none' };
    }

    case 'TRIAL':
    case 'ACTIVE': {
      const end = termEnd(state);

      if (end === null) {
        // Оплаченного срока нет вовсе — неоткуда считать; так быть не должно.
        return { kind: 'past_due', since: now };
      }

      if (now.getTime() >= end.getTime()) {
        // Пробный срок картой не продлевается: карты ещё нет, клуб платит сам.
        return state.status === 'ACTIVE' && canCharge ? { kind: 'charge' } : { kind: 'past_due', since: end };
      }

      const left = end.getTime() - now.getTime();
      const days = [...REMINDER_DAYS].reverse().find((d) => left <= d * DAY_MS);

      return days === undefined ? { kind: 'none' } : { kind: 'remind', days, endsAt: end };
    }
  }
}

/**
 * Месяцы к дате: 31 января + 1 месяц = 28 (29) февраля, а не 3 марта. По
 * UTC: оплаченный срок — момент, а не местная дата.
 */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();

  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);

  const last = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, last));

  return result;
}

/**
 * Срок, который покупает оплата. Активную подписку продлевает с конца
 * оплаченного — купивший заранее не теряет оставшиеся дни; остальные — с
 * момента оплаты (у приостановленного прошедшие дни не возвращаются).
 */
export function paidPeriod(
  state: { status: Status; paidUntil: Date | null; trialEndsAt: Date | null },
  now: Date,
  months: number,
): { from: Date; to: Date } {
  const carry =
    (state.status === 'ACTIVE' && state.paidUntil && state.paidUntil > now && state.paidUntil) ||
    (state.status === 'TRIAL' && state.trialEndsAt && state.trialEndsAt > now && state.trialEndsAt) ||
    null;
  const from = carry || now;

  return { from, to: addMonths(from, months) };
}

/**
 * Акты раз в месяц (решение владельца от 02.10.2026): срок режется на
 * месяцы от начала, сумма — поровну, остаток деления — в последнем, чтобы
 * сумма актов совпала с суммой платежа до копейки.
 */
export function monthlyActs(from: Date, to: Date, amount: number): { from: Date; to: Date; amount: number }[] {
  const periods: { from: Date; to: Date }[] = [];
  let cursor = from;

  for (let month = 1; cursor < to; month += 1) {
    const next = addMonths(from, month);
    const end = next < to ? next : to;
    periods.push({ from: cursor, to: end });
    cursor = end;
  }

  const share = Math.floor(amount / periods.length);

  return periods.map((period, index) => ({
    ...period,
    amount: index === periods.length - 1 ? amount - share * (periods.length - 1) : share,
  }));
}
