import type { BookingEntry } from '@yenisey/types';
import { formatKopecks } from './money';
import { plural } from './plural';
import type { SubscriptionAlert } from './subscriptionAlert';

/** Цена записи в строке: сумма — или «абонементом», если платил абонемент. */
export function entryPriceLabel(entry: Pick<BookingEntry, 'price' | 'paidBy'>): string {
  return entry.paidBy ? `абонементом «${entry.paidBy.planName}»` : formatKopecks(entry.price);
}

/**
 * Подпись кнопки отмены: что человек потеряет, если отменит сейчас. У записи
 * по абонементу — визит (вернётся или сгорит), у записи по цене — процент.
 */
export function cancelButtonLabel(
  entry: Pick<BookingEntry, 'paidBy' | 'cancelOutcome' | 'cancelChargePercentNow'>,
): string {
  if (entry.paidBy) {
    return entry.cancelOutcome === 'BURN' ? 'Отменить (визит сгорит)' : 'Отменить (визит вернётся)';
  }

  return entry.cancelChargePercentNow ? `Отменить (спишется ${entry.cancelChargePercentNow}%)` : 'Отменить';
}

/** Хвост статуса отменённой или пропущенной записи по абонементу. */
export function visitFateLabel(chargePercent: number | null): string {
  return chargePercent === 100 ? 'визит сгорел' : 'визит возвращён';
}

/**
 * Подписи абонементов — одинаковые в каталоге, в карточке человека и в
 * кабинете клиента. Три копии разошлись бы на первой же правке слова.
 */

/** «10 визитов · 30 дней», «Безлимит · 90 дней», «8 визитов · бессрочно». */
export function planTermsLabel(visitsCount: number | null, durationDays: number | null): string {
  const visits = visitsCount === null ? 'Безлимит' : visitsLabel(visitsCount);
  const term =
    durationDays === null ? 'бессрочно' : `${durationDays} ${plural(durationDays, 'день', 'дня', 'дней')}`;

  return `${visits} · ${term}`;
}

export function visitsLabel(count: number): string {
  return `${count} ${plural(count, 'визит', 'визита', 'визитов')}`;
}

/** Остаток абонемента: «осталось 3 визита» или «безлимит». */
export function remainingLabel(remainingVisits: number | null): string {
  return remainingVisits === null
    ? 'безлимит'
    : `осталось ${visitsLabel(remainingVisits)}`;
}

/**
 * Плашка «абонемент кончается» словами. Решает о ней `subscriptionAlert`, а
 * здесь только подпись: пороги — правило, а не текст, и живут отдельно.
 */
export function subscriptionAlertLabel(alert: SubscriptionAlert): string {
  if (alert.kind === 'visits') {
    return alert.visits <= 1 ? 'остался последний визит' : `осталось всего ${visitsLabel(alert.visits)}`;
  }

  return alert.days <= 1
    ? 'сегодня последний день'
    : `остаётся ${alert.days} ${plural(alert.days, 'день', 'дня', 'дней')}`;
}

/**
 * До какого дня действует: «по 18 октября», «бессрочно».
 *
 * `expiresAt` — первая минута, когда абонемент уже НЕ действует (полночь после
 * последнего дня), поэтому последний день — минутой раньше.
 */
export function validUntilLabel(expiresAt: string | null): string {
  if (expiresAt === null) {
    return 'бессрочно';
  }

  const lastMoment = new Date(Date.parse(expiresAt) - 60_000);

  return `по ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(lastMoment)}`;
}
