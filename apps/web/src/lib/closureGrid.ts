import type { ClosurePurpose, ClosureSlot, Weekday } from '@yenisey/types';

/**
 * Перевод между сеткой на экране и окнами расписания.
 *
 * На экране администратор закрашивает клетки «стол × полчаса», а в базе лежат
 * интервалы с назначением и тренером. Склейка соседних клеток в интервал и
 * обратный разбор собраны здесь: это чистая арифметика, и ошибка в ней стоит
 * стола, отданного клиенту прямо под групповой тренировкой.
 */

/**
 * Шаг сетки — полчаса, независимо от минимального шага брони зала.
 *
 * Совпадение с шагом брони не требуется: занятым считается любое окно,
 * ПЕРЕСЕКАЮЩЕЕСЯ с бронью, а не совпадающее с ней. Полчаса — компромисс между
 * подробностью и высотой таблицы: при шаге в 10 минут в сутках было бы 144
 * строки, и попасть мышью в нужную стало бы отдельной задачей.
 */
export const SLOT_MINUTES = 30;

/**
 * Границы сетки: с 06:00 до полуночи.
 *
 * Ночь из таблицы убрана — зал в это время закрыт, и двенадцать пустых строк
 * только мешали искать нужный час. Окна, попадающие в ночь, при этом не
 * теряются: см. `splitByGrid`.
 */
export const GRID_START_MINUTE = 6 * 60;
export const GRID_END_MINUTE = 24 * 60;

export const SLOTS_PER_DAY = (GRID_END_MINUTE - GRID_START_MINUTE) / SLOT_MINUTES;

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

/** Чем занят стол в клетке. `null` в карте не хранится — клетка просто отсутствует. */
export interface CellValue {
  purpose: ClosurePurpose;
  /** Тренер — у тренировки и спарринга. */
  coachId: string | null;
  /** Клиент — у аренды и робота. Оба поля разом не заполняются никогда. */
  clientId: string | null;
  /** Тип тренировки — только у тренировки. */
  trainingTypeId: string | null;
  /** Турнир — только у турнира и только в расписании даты. */
  tournamentId: string | null;
}

/**
 * Кто закреплён за клеткой, независимо от назначения.
 *
 * Сетке всё равно, тренер это или клиент: ей нужно знать, менялся ли человек
 * между соседними клетками и каким цветом красить.
 */
export function personOf(value: CellValue): string | null {
  return value.coachId ?? value.clientId;
}

/**
 * Закрашенные клетки.
 *
 * Map, а не Set: клетка теперь несёт назначение и тренера, а не только
 * признак «занято».
 */
export type Cells = Map<string, CellValue>;

/**
 * Ключ клетки. Строка, а не объект: клетки живут в Map, а объекты в ней
 * сравниваются по ссылке.
 *
 * `lane` — дорожка расписания: день недели в шаблоне («2») или единственная
 * дорожка в расписании даты («day»). Так одна и та же сетка обслуживает оба
 * режима, не заводя двух почти одинаковых компонентов.
 */
export function cellKey(lane: string, tableId: string, slot: number): string {
  return `${lane}|${tableId}|${slot}`;
}

/** Минута начала слота от полуночи. */
export function slotMinute(slot: number): number {
  return GRID_START_MINUTE + slot * SLOT_MINUTES;
}

/** Время начала слота в виде «15:00». */
export function slotLabel(slot: number): string {
  const minutes = slotMinute(slot);
  const hours = Math.floor(minutes / 60);

  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Разделение окна по нижней границе сетки.
 *
 * Ночная часть в таблице не показывается, но и не пропадает: она возвращается
 * отдельно и уезжает обратно на сервер нетронутой. Иначе сохранение сетки
 * тихо стирало бы всё, что заведено до шести утра.
 *
 * Стык границы пересечением не считается, поэтому сохранённая ночная часть и
 * клетки сетки никогда не наложатся друг на друга.
 */
export function splitByGrid<T extends ClosureSlot>(slots: readonly T[]): {
  inGrid: T[];
  night: T[];
} {
  const inGrid: T[] = [];
  const night: T[] = [];

  for (const slot of slots) {
    if (slot.endMinute <= GRID_START_MINUTE) {
      night.push(slot);
      continue;
    }

    if (slot.startMinute >= GRID_START_MINUTE) {
      inGrid.push(slot);
      continue;
    }

    // Окно пересекает шесть утра: ночной хвост сохраняем как есть, дневную
    // часть отдаём сетке.
    night.push({ ...slot, endMinute: GRID_START_MINUTE });
    inGrid.push({ ...slot, startMinute: GRID_START_MINUTE });
  }

  return { inGrid, night };
}

/**
 * Окна → закрашенные клетки.
 *
 * Границы окна округляются наружу: окно 15:10–15:50 не совпадает с сеткой, но
 * занятое время терять нельзя, поэтому клетка 15:00–15:30 считается занятой
 * целиком. Такое окно может появиться, если расписание завели не из этой
 * сетки — например, через API.
 */
export function slotsToCells(
  slots: readonly ClosureSlot[],
  lane: (slot: ClosureSlot) => string,
): Cells {
  const cells: Cells = new Map();

  for (const slot of slots) {
    const first = Math.floor((slot.startMinute - GRID_START_MINUTE) / SLOT_MINUTES);
    const last = Math.ceil((slot.endMinute - GRID_START_MINUTE) / SLOT_MINUTES);

    for (let index = Math.max(0, first); index < Math.min(last, SLOTS_PER_DAY); index += 1) {
      cells.set(cellKey(lane(slot), slot.tableId, index), {
        purpose: slot.purpose,
        coachId: slot.coachId,
        clientId: slot.clientId,
        trainingTypeId: slot.trainingTypeId,
        tournamentId: slot.tournamentId,
      });
    }
  }

  return cells;
}

/**
 * Закрашенные клетки → окна.
 *
 * Соседние клетки склеиваются в одно окно, но только если совпадают и
 * назначение, и закреплённый человек: тренировка Иванова, идущая встык с
 * тренировкой Петрова, — это два занятия, и слить их в одно значило бы
 * приписать часы одному из них. То же с арендой двух разных клиентов подряд.
 */
export function cellsToSlots(
  cells: Cells,
  lanes: readonly string[],
  tableIds: readonly string[],
): (ClosureSlot & { lane: string })[] {
  const slots: (ClosureSlot & { lane: string })[] = [];

  for (const lane of lanes) {
    for (const tableId of tableIds) {
      let runStart: number | null = null;
      let runValue: CellValue | null = null;

      // Проходим на слот дальше конца сетки, чтобы окно, упирающееся в
      // полночь, закрылось той же веткой, что и все остальные.
      for (let slot = 0; slot <= SLOTS_PER_DAY; slot += 1) {
        const value = slot < SLOTS_PER_DAY ? cells.get(cellKey(lane, tableId, slot)) : undefined;
        const continues =
          value !== undefined &&
          runValue !== null &&
          value.purpose === runValue.purpose &&
          value.coachId === runValue.coachId &&
          value.clientId === runValue.clientId &&
          value.trainingTypeId === runValue.trainingTypeId &&
          value.tournamentId === runValue.tournamentId;

        if (!continues && runStart !== null && runValue !== null) {
          slots.push({
            lane,
            tableId,
            startMinute: slotMinute(runStart),
            endMinute: slotMinute(slot),
            purpose: runValue.purpose,
            coachId: runValue.coachId,
            clientId: runValue.clientId,
            trainingTypeId: runValue.trainingTypeId,
            tournamentId: runValue.tournamentId,
          });
          runStart = null;
          runValue = null;
        }

        if (value !== undefined && runStart === null) {
          runStart = slot;
          runValue = value;
        }
      }
    }
  }

  return slots;
}

/** Копия одной дорожки в другие. Клетки дорожек-получателей заменяются целиком. */
export function copyLane(
  cells: Cells,
  from: string,
  to: readonly string[],
  tableIds: readonly string[],
): Cells {
  const next = new Map(cells);

  for (const lane of to) {
    if (lane === from) {
      continue;
    }

    for (const tableId of tableIds) {
      for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
        const source = cells.get(cellKey(from, tableId, slot));
        const key = cellKey(lane, tableId, slot);

        if (source) {
          next.set(key, source);
        } else {
          next.delete(key);
        }
      }
    }
  }

  return next;
}

/** Сколько клеток занято на дорожке — для подписи на вкладке. */
export function countOnLane(cells: Cells, lane: string): number {
  let count = 0;

  for (const key of cells.keys()) {
    if (key.startsWith(`${lane}|`)) {
      count += 1;
    }
  }

  return count;
}

/** Совпадают ли две сетки — чтобы не предлагать сохранить неизменённое. */
export function sameCells(a: Cells, b: Cells): boolean {
  if (a.size !== b.size) {
    return false;
  }

  for (const [key, value] of a) {
    const other = b.get(key);

    if (
      !other ||
      other.purpose !== value.purpose ||
      other.coachId !== value.coachId ||
      other.clientId !== value.clientId ||
      other.trainingTypeId !== value.trainingTypeId ||
      other.tournamentId !== value.tournamentId
    ) {
      return false;
    }
  }

  return true;
}
