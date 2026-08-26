import type { ClosureRule, ClosureRuleDraft, Weekday } from '@yenisey/types';

/**
 * Перевод между сеткой на экране и окнами расписания.
 *
 * На экране администратор закрашивает клетки «стол × полчаса», а в базе лежат
 * интервалы. Склейка соседних клеток в интервал и обратный разбор собраны
 * здесь: это чистая арифметика, и ошибка в ней стоит стола, отданного клиенту
 * под групповой тренировкой.
 */

/**
 * Шаг сетки — полчаса, независимо от минимального шага брони клуба.
 *
 * Совпадение с шагом брони не требуется: закрытым считается любое окно,
 * ПЕРЕСЕКАЮЩЕЕСЯ с бронью, а не совпадающее с ней. Полчаса — компромисс между
 * подробностью и высотой таблицы: при шаге в 10 минут в сутках было бы 144
 * строки, и попасть мышью в нужную стало бы отдельной задачей.
 */
export const SLOT_MINUTES = 30;

/** Сутки целиком: правило, заведённое на ночь, тоже должно быть видно и правимо. */
export const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES;

export const WEEKDAYS: { value: Weekday; short: string; full: string }[] = [
  { value: 1, short: 'Пн', full: 'Понедельник' },
  { value: 2, short: 'Вт', full: 'Вторник' },
  { value: 3, short: 'Ср', full: 'Среда' },
  { value: 4, short: 'Чт', full: 'Четверг' },
  { value: 5, short: 'Пт', full: 'Пятница' },
  { value: 6, short: 'Сб', full: 'Суббота' },
  { value: 7, short: 'Вс', full: 'Воскресенье' },
];

/** Будни — для кнопки «скопировать на все будни». */
export const WORKDAYS: Weekday[] = [1, 2, 3, 4, 5];

/** Ключ клетки. Строка, а не объект: клетки живут в Set, а объекты в нём не сравниваются. */
export function cellKey(weekday: Weekday, tableId: string, slot: number): string {
  return `${weekday}|${tableId}|${slot}`;
}

/** Время начала слота в виде «15:00». */
export function slotLabel(slot: number): string {
  const minutes = slot * SLOT_MINUTES;
  const hours = Math.floor(minutes / 60);

  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Окна расписания → закрашенные клетки.
 *
 * Границы окна округляются наружу: окно 15:10–15:50 не совпадает с сеткой, но
 * закрытое время терять нельзя, поэтому клетка 15:00–15:30 считается
 * закрытой целиком. Такое окно может появиться, если расписание завели не из
 * этой сетки — например, через API.
 */
export function rulesToCells(rules: readonly ClosureRule[]): Set<string> {
  const cells = new Set<string>();

  for (const rule of rules) {
    const first = Math.floor(rule.startMinute / SLOT_MINUTES);
    const last = Math.ceil(rule.endMinute / SLOT_MINUTES);

    for (let slot = first; slot < last && slot < SLOTS_PER_DAY; slot += 1) {
      cells.add(cellKey(rule.weekday, rule.tableId, slot));
    }
  }

  return cells;
}

/**
 * Закрашенные клетки → окна расписания.
 *
 * Соседние клетки склеиваются в одно окно: восемь получасовых строк подряд —
 * это «с 15:00 до 19:00», а не восемь отдельных записей. Иначе список окон
 * распухал бы, а exclusion-констрейнт в базе всё равно требует, чтобы окна
 * одного стола не соприкасались внахлёст.
 */
export function cellsToRules(
  cells: ReadonlySet<string>,
  tableIds: readonly string[],
): ClosureRuleDraft[] {
  const rules: ClosureRuleDraft[] = [];

  for (const { value: weekday } of WEEKDAYS) {
    for (const tableId of tableIds) {
      let runStart: number | null = null;

      // Проходим на слот дальше конца суток, чтобы окно, упирающееся в
      // полночь, закрылось той же веткой, что и все остальные.
      for (let slot = 0; slot <= SLOTS_PER_DAY; slot += 1) {
        const closed = slot < SLOTS_PER_DAY && cells.has(cellKey(weekday, tableId, slot));

        if (closed && runStart === null) {
          runStart = slot;
        }

        if (!closed && runStart !== null) {
          rules.push({
            tableId,
            weekday,
            startMinute: runStart * SLOT_MINUTES,
            endMinute: slot * SLOT_MINUTES,
          });
          runStart = null;
        }
      }
    }
  }

  return rules;
}

/** Копия одного дня в другие. Клетки дней-получателей заменяются целиком. */
export function copyDay(
  cells: ReadonlySet<string>,
  from: Weekday,
  to: readonly Weekday[],
  tableIds: readonly string[],
): Set<string> {
  const next = new Set(cells);

  for (const weekday of to) {
    if (weekday === from) {
      continue;
    }

    for (const tableId of tableIds) {
      for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
        const key = cellKey(weekday, tableId, slot);

        if (cells.has(cellKey(from, tableId, slot))) {
          next.add(key);
        } else {
          next.delete(key);
        }
      }
    }
  }

  return next;
}

/** Сколько окон закрыто в дне — для подписи на вкладке. */
export function countClosedSlots(cells: ReadonlySet<string>, weekday: Weekday): number {
  let count = 0;

  for (const key of cells) {
    if (key.startsWith(`${weekday}|`)) {
      count += 1;
    }
  }

  return count;
}
