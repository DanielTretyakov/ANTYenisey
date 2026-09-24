/**
 * Неделя для фильтра мероприятий на странице клуба: с понедельника по
 * воскресенье по часам браузера — так же, как показывается время в списке
 * (см. `When`): человеку важно, в какой ЕГО день идти.
 *
 * Чистый модуль без импортов — его гоняет `node --test`.
 */

const DAY_MS = 24 * 3600_000;

/** Понедельник 00:00 недели, в которую попадает `now`, плюс `offset` недель. */
export function weekStart(now: Date, offset = 0): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // getDay(): воскресенье — 0; неделя в России начинается с понедельника.
  const sinceMonday = (start.getDay() + 6) % 7;

  start.setDate(start.getDate() - sinceMonday + offset * 7);

  return start;
}

/** Семь дней недели — полночь каждого, по часам браузера. */
export function weekDays(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

/** Конец недели — понедельник следующей, 00:00 (граница не включается). */
export function weekEnd(start: Date): Date {
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return end;
}

/** Тот же ли это день по часам браузера. */
export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** «22–28 сентября» или «29 сентября – 5 октября». */
export function weekLabel(start: Date): string {
  const last = new Date(start.getTime() + 6 * DAY_MS + 12 * 3600_000);
  const month = (date: Date): string => new Intl.DateTimeFormat('ru-RU', { month: 'long', day: 'numeric' }).format(date);

  return start.getMonth() === last.getMonth()
    ? `${start.getDate()}–${month(last)}`
    : `${month(start)} – ${month(last)}`;
}
