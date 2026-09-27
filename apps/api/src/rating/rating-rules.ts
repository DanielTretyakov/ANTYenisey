/**
 * Рейтинг посещений клуба (решение владельца от 26.09.2026): публичный, по
 * отмеченным «пришёл» визитам, не больше одного в день, за месяц, год или всё
 * время.
 *
 * Чистый модуль под тестами — без относительных импортов (см. CLAUDE.md).
 */

export type RatingPeriod = 'month' | 'year' | 'all';

/** Сколько строк показывает рейтинг. */
export const RATING_SIZE = 50;

/**
 * С какой местной даты считается период: месяц и год — календарные, с
 * первого числа, а не «последние 30 дней»: «лучшие в сентябре» понятнее и не
 * ползут каждый день. У «всего времени» начала нет.
 */
export function periodStart(period: RatingPeriod, today: string): string | null {
  switch (period) {
    case 'month':
      return `${today.slice(0, 7)}-01`;
    case 'year':
      return `${today.slice(0, 4)}-01-01`;
    case 'all':
      return null;
  }
}

/**
 * Места с дележом: равное число визитов — одно место, следующий идёт через
 * занятые (1, 2, 2, 4). Внутри равных — по имени: порядок не должен прыгать
 * от запроса к запросу.
 */
export function ranked<T extends { visits: number; name: string }>(rows: readonly T[]): (T & { place: number })[] {
  const sorted = [...rows].sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name, 'ru'));
  let place = 0;

  return sorted.map((row, index) => {
    if (index === 0 || sorted[index - 1]!.visits !== row.visits) {
      place = index + 1;
    }

    return { ...row, place };
  });
}
