/**
 * Календарь месяца на странице клуба (решение владельца от 25.09.2026):
 * общая картина — что и в какие дни. По часам браузера, как и неделя
 * (`lib/week.ts`): человеку важно, в какой ЕГО день идти.
 *
 * Чистый модуль без импортов — его гоняет `node --test`.
 */

/** Первое число месяца, в который попадает `now`, плюс `offset` месяцев. */
export function monthStart(now: Date, offset = 0): Date {
  return new Date(now.getFullYear(), now.getMonth() + offset, 1);
}

/** Первое число следующего месяца — граница окна запроса, не включается. */
export function monthEnd(start: Date): Date {
  return new Date(start.getFullYear(), start.getMonth() + 1, 1);
}

/**
 * Клетки сетки: с понедельника недели, в которую попадает первое число, до
 * воскресенья недели последнего числа. Дни соседних месяцев в сетке есть —
 * иначе первая строка начиналась бы с дыр, — но `inMonth` у них ложен.
 */
export function monthGrid(start: Date): { date: Date; inMonth: boolean }[] {
  const first = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  // getDay(): воскресенье — 0; неделя в России начинается с понедельника.
  const lead = (first.getDay() + 6) % 7;
  const tail = 6 - ((last.getDay() + 6) % 7);
  const count = lead + last.getDate() + tail;

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(first.getFullYear(), first.getMonth(), 1 - lead + index);

    return { date, inMonth: date.getMonth() === first.getMonth() };
  });
}

/** «Октябрь 2026». */
export function monthLabel(start: Date): string {
  const label = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(start).replace(/\s*г\.$/, '');

  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Ключ дня по часам браузера — для группировки мероприятий по клеткам. */
export function dayKey(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
