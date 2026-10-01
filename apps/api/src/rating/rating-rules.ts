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

/** День с визитом в клуб — местная дата клуба «2026-09-30». */
export interface ClubVisitDay {
  tenantId: string;
  date: string;
}

export interface ClubTop {
  tenantId: string;
  name: string;
  visits: number;
  place: number;
}

/**
 * «Больше всего посещений» в профиле игрока (решение владельца от
 * 30.09.2026): клубы, где он бывал чаще всего, за календарный месяц, год и
 * всё время. Визит — день с отметкой «пришёл», не больше одного в день, как в
 * рейтинге клуба; «сегодня» у каждого клуба своё — по его поясу.
 */
export function clubTops(
  days: readonly ClubVisitDay[],
  todayOf: (tenantId: string) => string,
  nameOf: (tenantId: string) => string,
  size = 3,
): Record<RatingPeriod, ClubTop[]> {
  const byTenant = new Map<string, Set<string>>();

  for (const day of days) {
    const dates = byTenant.get(day.tenantId) ?? new Set<string>();
    dates.add(day.date);
    byTenant.set(day.tenantId, dates);
  }

  const top = (period: RatingPeriod): ClubTop[] => {
    const rows = [...byTenant].map(([tenantId, dates]) => {
      const since = periodStart(period, todayOf(tenantId));
      const visits = since === null ? dates.size : [...dates].filter((date) => date >= since).length;

      return { tenantId, name: nameOf(tenantId), visits };
    });

    return ranked(rows.filter((row) => row.visits > 0)).slice(0, size);
  };

  return { month: top('month'), year: top('year'), all: top('all') };
}
