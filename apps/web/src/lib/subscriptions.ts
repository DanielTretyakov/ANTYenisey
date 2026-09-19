import { plural } from './plural';

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
