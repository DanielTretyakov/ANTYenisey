import type {
  ClosurePurpose,
  ClosureRuleDraft,
  ClosureSlot,
  DayClosureDraft,
  Weekday,
} from '@yenisey/types';

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
  /**
   * Конкретное занятие — только у тренировки и только в расписании даты.
   * Необязательно даже там: индивидуальное занятие закрывает стол, но
   * записываться на него некому.
   */
  trainingSessionId: string | null;
  /** Турнир — только у турнира и только в расписании даты. */
  tournamentId: string | null;
  /**
   * Тип турнира.
   *
   * В шаблоне недели он и хранится: у конкретного проведения есть дата, а
   * шаблон повторяется. В расписании даты тип живёт только до сохранения —
   * тогда из него заводится само проведение, и дальше окно ссылается уже на
   * него. Заводить турнир на каждый мазок значило бы засорять базу теми,
   * которые администратор тут же стёр.
   */
  tournamentTypeId: string | null;
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
        trainingSessionId: slot.trainingSessionId,
        tournamentId: slot.tournamentId,
        tournamentTypeId: slot.tournamentTypeId,
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
): (ClosureSlot & { lane: string; tournamentTypeId: string | null })[] {
  const slots: (ClosureSlot & { lane: string; tournamentTypeId: string | null })[] = [];

  for (const lane of lanes) {
    for (const tableId of tableIds) {
      let runStart: number | null = null;
      let runValue: CellValue | null = null;

      // Проходим на слот дальше конца сетки, чтобы окно, упирающееся в
      // полночь, закрылось той же веткой, что и все остальные.
      for (let slot = 0; slot <= SLOTS_PER_DAY; slot += 1) {
        const value = slot < SLOTS_PER_DAY ? cells.get(cellKey(lane, tableId, slot)) : undefined;
        const continues =
          value !== undefined && runValue !== null && sameValue(value, runValue);

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
            trainingSessionId: runValue.trainingSessionId,
            tournamentId: runValue.tournamentId,
            tournamentTypeId: runValue.tournamentTypeId,
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

/**
 * Одинаковы ли две клетки.
 *
 * Единственное сравнение значений на весь модуль. Раньше их было три —
 * в `sameCells`, в склейке окон и в решении «красим или стираем», — и они
 * успели разойтись: `sameCells` не смотрел на `trainingSessionId`, а склейка
 * смотрела. Из-за этого подмена занятия при неизменных прочих полях не поднимала
 * «есть несохранённые правки», а сохранение при этом резало окно надвое.
 */
export function sameValue(a: CellValue | undefined, b: CellValue | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }

  return (
    a.purpose === b.purpose &&
    a.coachId === b.coachId &&
    a.clientId === b.clientId &&
    a.trainingTypeId === b.trainingTypeId &&
    a.trainingSessionId === b.trainingSessionId &&
    a.tournamentId === b.tournamentId &&
    a.tournamentTypeId === b.tournamentTypeId
  );
}

/** Совпадают ли две сетки — чтобы не предлагать сохранить неизменённое. */
export function sameCells(a: Cells, b: Cells): boolean {
  if (a.size !== b.size) {
    return false;
  }

  for (const [key, value] of a) {
    if (!sameValue(value, b.get(key))) {
      return false;
    }
  }

  return true;
}

/**
 * Окно в том виде, в каком его принимает сервер.
 *
 * Поля перечислены руками, а не сняты с исходного объекта через `...rest`.
 * Разница не косметическая: у шаблонного окна есть `weekday`, и когда день
 * показан по шаблону, его ночная часть уезжала в `replaceDay` вместе с этим
 * полем. `forbidNonWhitelisted` на сервере такое тело отклоняет, и сохранение
 * дня падало четырёхсотой ошибкой на любом зале, где в шаблоне есть окно до
 * шести утра. Явный список полей делает это невозможным по построению.
 */
export function toDayClosureDraft(slot: ClosureSlot): DayClosureDraft {
  return {
    tableId: slot.tableId,
    startMinute: slot.startMinute,
    endMinute: slot.endMinute,
    purpose: slot.purpose,
    coachId: slot.coachId,
    clientId: slot.clientId,
    trainingTypeId: slot.trainingTypeId,
    trainingSessionId: slot.trainingSessionId,
    tournamentId: slot.tournamentId,
    tournamentTypeId: slot.tournamentTypeId,
  };
}

/** То же для шаблона недели: к окну добавляется день недели. */
export function toClosureRuleDraft(slot: ClosureSlot, weekday: Weekday): ClosureRuleDraft {
  return { ...toDayClosureDraft(slot), weekday };
}

/** День недели по ISO-8601 для даты вида «2026-03-12». */
export function weekdayOf(date: string): Weekday {
  // getUTCDay даёт 0 для воскресенья; ISO-8601 ждёт 7.
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();

  return (day === 0 ? 7 : day) as Weekday;
}

/**
 * Дата, сдвинутая на сутки вперёд или назад.
 *
 * Считается в UTC намеренно: календарная дата пояса не имеет — «12 марта» это
 * «12 марта» и в Красноярске, и в Москве. Складывать её в местном времени
 * значило бы на переходе на летнее время получить тот же день дважды.
 */
export function shiftDate(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);

  at.setUTCDate(at.getUTCDate() + days);

  return at.toISOString().slice(0, 10);
}

/**
 * Который сейчас час в зале, в минутах от местной полуночи.
 *
 * Пояс ЗАЛА, а не браузера: клуб во Владивостоке администрируют и из Москвы, и
 * линия текущего времени, нарисованная по часам администратора, показывала бы
 * ему вечер, когда в зале утро.
 *
 * `at` — аргумент ради теста: без него проверить нечего, кроме «не падает».
 */
export function nowMinuteIn(timezone: string, at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    // h23 обязателен: иначе полночь приходит как «24», и сутки начинаются с
    // 1440-й минуты.
    hourCycle: 'h23',
  }).formatToParts(at);

  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return value('hour') * 60 + value('minute');
}

/**
 * Пометка окон, которых администратор коснулся в этой правке.
 *
 * Нужна, чтобы не заводить занятия и турниры по окнам, которые он не размечал,
 * а просто увидел. День, отвязанный от шаблона, приходит полным окон с типом
 * тренировки, но без занятия — и следующая правка одной-единственной клетки
 * аренды заводила бы занятия сразу на все такие окна: отличить их по полям
 * нельзя, они выглядят одинаково.
 *
 * Сравнение идёт по клеткам, а не по окнам: окно — это уже результат склейки,
 * и продление тренировки на полчаса даёт другое окно с теми же полями.
 */
export function markTouched<T extends ClosureSlot>(
  slots: readonly T[],
  cells: Cells,
  saved: Cells,
  lane: (slot: T) => string,
): (T & { touched: boolean })[] {
  return slots.map((slot) => {
    const first = Math.max(0, Math.floor((slot.startMinute - GRID_START_MINUTE) / SLOT_MINUTES));
    const last = Math.min(
      SLOTS_PER_DAY,
      Math.ceil((slot.endMinute - GRID_START_MINUTE) / SLOT_MINUTES),
    );

    let touched = false;

    for (let index = first; index < last && !touched; index += 1) {
      const key = cellKey(lane(slot), slot.tableId, index);

      touched = !sameValue(cells.get(key), saved.get(key));
    }

    return { ...slot, touched };
  });
}
