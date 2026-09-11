/**
 * Время на экране смены — по поясу ЗАЛА, а не браузера.
 *
 * «Требует отметки» собирает записи всех залов клуба, и залы бывают в разных
 * регионах: по часам браузера запись в Абакане показалась бы на час раньше.
 */

/** «18:30». */
export function clockIn(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** «2026-03-12» — местная дата момента, чтобы сравнить её с датой экрана. */
export function dateIn(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** «в 18:30», если это день экрана, иначе «12.03 в 18:30». */
export function momentIn(iso: string, timezone: string, screenDate: string): string {
  const date = dateIn(iso, timezone);
  const clock = clockIn(iso, timezone);

  return date === screenDate ? `в ${clock}` : `${date.slice(8, 10)}.${date.slice(5, 7)} в ${clock}`;
}
