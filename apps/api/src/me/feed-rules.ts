/**
 * Лента «Ближайшее в моих клубах»: ближайшие НЕПОВТОРЯЮЩИЕСЯ мероприятия.
 *
 * Чистый модуль без относительных импортов — его гоняет `node --test`.
 *
 * Повтор — то же мероприятие того же клуба в другой день: групповая
 * тренировка по вторникам и четвергам заняла бы пять строк ленты из пяти, и
 * человек не увидел бы ни турнира в субботу, ни детской группы. Поэтому от
 * каждого (клуб, вид, тип) берётся ближайшее проведение, а следующие —
 * пропускаются (решение владельца от 24.09.2026: «5 ближайших
 * неповторяющихся событий»).
 */
export interface FeedCandidate {
  startsAt: string;
  /** Клуб, вид и тип — то, что делает два проведения «тем же самым». */
  sameAs: string;
}

export function distinctNearest<T extends FeedCandidate>(rows: T[], limit: number): T[] {
  const seen = new Set<string>();
  const picked: T[] = [];

  for (const row of [...rows].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    if (seen.has(row.sameAs)) continue;

    seen.add(row.sameAs);
    picked.push(row);

    if (picked.length === limit) break;
  }

  return picked;
}
