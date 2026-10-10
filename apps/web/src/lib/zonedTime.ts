/**
 * Время мероприятия: по часам его зала и, если у смотрящего пояс другой, —
 * ещё и по его часам (решение владельца от 05.10.2026).
 *
 * Главное — время зала: оно на афише, в сетке расписания и в сообщениях MAX,
 * и по нему администратор называет время по телефону. Время браузера — второй
 * строкой «у вас 14:00», только когда часы расходятся: человек из Москвы,
 * смотрящий красноярскую тренировку, видит и то и другое, а красноярец — одно.
 *
 * Модуль самодостаточен (без относительных импортов): его гоняет `node --test`.
 */

/** Пояс браузера смотрящего. */
export function viewerZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Календарная дата и время «ЧЧ:ММ» момента по часам пояса. */
function wallClock(instant: Date, zone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    // h23 обязателен: иначе полночь приходит как «24».
    hourCycle: 'h23',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? '';

  return { date: `${value('year')}-${value('month')}-${value('day')}`, time: `${value('hour')}:${value('minute')}` };
}

const asDate = (instant: string | Date): Date => (typeof instant === 'string' ? new Date(instant) : instant);

/** «18:00» по часам пояса. */
export function timeIn(instant: string | Date, zone: string): string {
  return wallClock(asDate(instant), zone).time;
}

/** Календарная дата «2026-10-07» по часам пояса — для раскладки по дням. */
export function dayIn(instant: string | Date, zone: string): string {
  return wallClock(asDate(instant), zone).date;
}

/** Дата словами по часам пояса: опции — как у `Intl.DateTimeFormat`. */
export function dateIn(instant: string | Date, zone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: zone }).format(asDate(instant));
}

/**
 * Время того же мероприятия по часам смотрящего — «у вас 14:00–15:30», — или
 * `null`, если часы зала и смотрящего в этот момент совпадают. Сравниваются
 * сами часы, а не названия поясов: Новокузнецк и Красноярск — разные пояса с
 * одинаковым временем, и вторая строка там была бы шумом.
 *
 * Если у смотрящего уже другой день, он назван: «у вас 6 окт., 21:00».
 */
export function viewerTime(
  startsAt: string,
  endsAt: string | null,
  zone: string,
  viewer: string = viewerZone(),
): string | null {
  const start = new Date(startsAt);
  const there = wallClock(start, zone);
  const here = wallClock(start, viewer);

  if (there.date === here.date && there.time === here.time) {
    return null;
  }

  const range = endsAt ? `${here.time}–${timeIn(endsAt, viewer)}` : here.time;
  const day = there.date === here.date ? '' : `${dateIn(start, viewer, { day: 'numeric', month: 'short' })}, `;

  return `у вас ${day}${range}`;
}
