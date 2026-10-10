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

/**
 * «Занятие заведётся при сохранении» — метка клетки, закрашенной кистью
 * тренировки в расписании даты.
 *
 * Заменила прежнее «окно тронуто в этой правке» (`markTouched`), которое
 * сравнивало клетку со снимком: окно тренировки из шаблона, перекрашенное той
 * же кистью, выглядело нетронутым — и открыть на него запись было нечем, кроме
 * «стереть, сохранить, нарисовать, сохранить». Метка же стоит ровно на том,
 * что закрасила кисть, и на сервер не уходит никогда: `planDayEvents`
 * заменяет её настоящим занятием.
 */
export const NEW_SESSION = 'new';

/** Чем занят стол в клетке. `null` в карте не хранится — клетка просто отсутствует. */
export interface CellValue {
  purpose: ClosurePurpose;
  /**
   * Тренер — у тренировки и спарринга. Больше за окном никого не бывает:
   * клиент у аренды был ловушкой — окно не несёт ни цены, ни отмены, а человек
   * считал себя записанным. Теперь его держит бронь стола.
   */
  coachId: string | null;
  /** Тип тренировки — только у тренировки. */
  trainingTypeId: string | null;
  /**
   * Конкретное занятие — только у тренировки и только в расписании даты.
   * Необязательно даже там: индивидуальное занятие закрывает стол, но
   * записываться на него некому. `NEW_SESSION` — занятие заведётся при
   * сохранении.
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
 * Кто закреплён за клеткой. Сетке он нужен, чтобы знать, менялся ли человек
 * между соседними клетками и каким цветом красить.
 */
export function personOf(value: CellValue): string | null {
  return value.coachId;
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
 * приписать часы одному из них.
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
 * Момент в ISO → минуты от местной полуночи зала.
 *
 * Тем же способом, что и «сейчас»: бронь, начавшаяся в 18:00 в Абакане, в
 * сетке абаканского зала должна стоять на 18:00, а не на московских часах
 * администратора.
 */
export function minuteOfInstant(iso: string, timezone: string): number {
  return nowMinuteIn(timezone, new Date(iso));
}

/**
 * Какие клетки сетки покрывает окно `[startMinute, endMinute)`.
 *
 * Возвращает полуинтервал `[from, to)` уже подрезанным по сетке: ночное время
 * в таблицу не попадает, а бронь, кончающаяся в полночь, упирается в её низ.
 * Частично занятая клетка считается занятой целиком — стол в эти полчаса не
 * свободен, и показать его свободным значило бы соврать.
 */
export function slotRange(startMinute: number, endMinute: number): { from: number; to: number } {
  const from = Math.max(0, Math.floor((startMinute - GRID_START_MINUTE) / SLOT_MINUTES));
  const to = Math.min(SLOTS_PER_DAY, Math.ceil((endMinute - GRID_START_MINUTE) / SLOT_MINUTES));

  return { from, to: Math.max(from, to) };
}

/**
 * Совпадает ли клетка с кистью — по тому, что кисть задаёт: назначению,
 * тренеру, типу занятия и типу турнира.
 *
 * Решает, что делает нажатие: совпала — стирает, нет — красит. Раньше
 * сравнивались только назначение и тренер, и клетка «Детской тренировки» под
 * кистью «Первой подачи» того же тренера стиралась вместо перекраски.
 *
 * Окно тренировки без занятия кисти дня не равно: кисть дня заводит занятие,
 * и перекраска такого окна — способ открыть на него запись.
 */
export function matchesBrush(cell: CellValue, brush: CellValue): boolean {
  if (!sameKind(cell, brush)) {
    return false;
  }

  if (brush.trainingSessionId === NEW_SESSION) {
    return cell.trainingSessionId !== null;
  }

  return true;
}

/**
 * Одно ли это по виду: назначение, тренер, тип занятия и тип турнира — то, что
 * подписано в клетке. Конкретные занятие и турнир не сравниваются: продление
 * группы, ещё не сохранённое, читается тем же окном, а не вторым.
 */
export function sameKind(a: CellValue, b: CellValue): boolean {
  return (
    a.purpose === b.purpose &&
    a.coachId === b.coachId &&
    a.trainingTypeId === b.trainingTypeId &&
    a.tournamentTypeId === b.tournamentTypeId
  );
}

/** Ссылка окна на мероприятие: уже заведённое или то, что заведётся по плану. */
export type EventRef = { id: string } | { create: number };

export interface DayEventsPlan<T extends ClosureSlot> {
  /** Турниры, которые надо завести: один на тип в этом дне. */
  tournaments: { tournamentTypeId: string; startMinute: number; endMinute: number }[];
  /** Занятия, которые надо завести: одно на связный отрезок времени пары «тип + тренер». */
  sessions: { trainingTypeId: string; coachId: string; startMinute: number; endMinute: number }[];
  slots: { slot: T; tournament: EventRef | null; session: EventRef | null }[];
}

/** Соприкасаются ли окна по времени — стык считается: 18:00–19:00 и 19:00–20:00 — одна группа. */
function touches(a: ClosureSlot, b: ClosureSlot): boolean {
  return a.startMinute <= b.endMinute && b.startMinute <= a.endMinute;
}

function overlapMinutes(a: ClosureSlot, b: ClosureSlot): number {
  return Math.max(0, Math.min(a.endMinute, b.endMinute) - Math.max(a.startMinute, b.startMinute));
}

/**
 * Какие турниры и занятия завести под окна дня — и на что сослаться каждому окну.
 *
 * Мероприятие заводится не мазком кисти, а сохранением: иначе база
 * наполнялась бы турнирами, которые тут же стёрли. Правила:
 *
 * - **Турнир — один на тип в дне.** Окно турнира в расписании даты обязано
 *   ссылаться на проведение (`DayClosure_attachments_match_purpose`), поэтому
 *   заводится на каждый тип без проведения — в том числе пришедший из
 *   шаблона. Если турнир этого типа в дне уже есть (стоит в сетке или стоял до
 *   правки), новые окна идут к нему: раньше дорисованный час заводил второй
 *   «Клуб 100» на ту же субботу.
 * - **Занятие — только по окнам с `NEW_SESSION`**, то есть закрашенным кистью
 *   тренировки в этой правке. Окна из шаблона несут тип, но не занятие, и
 *   заводить запись на каждое значило бы открыть клиентам группы, которые
 *   никто не собирал.
 * - **Одно занятие — связный отрезок времени пары «тип + тренер»**, на
 *   скольких бы столах он ни шёл. Раньше пара давала одно занятие на весь
 *   день, и утренняя с вечерней группой одного тренера сливались в занятие
 *   10:00–19:00.
 * - **Окно, примыкающее к уже заведённому занятию той же пары, — продолжение
 *   этого занятия**, а не новое: записавшиеся остаются в своей группе, а
 *   границы сервер подтянет по окнам. Это же — и для окон, которые стояли до
 *   правки: перенос группы на другие столы в то же время её не пересоздаёт.
 *
 * Окно без типа или без тренера остаётся без мероприятия — его отклонит
 * сервер с внятной причиной.
 *
 * `saved` — окна дня до правки: по ним узнаются мероприятия, стёртые и тут же
 * нарисованные заново.
 */
export function planDayEvents<T extends ClosureSlot>(
  slots: readonly T[],
  saved: readonly ClosureSlot[],
): DayEventsPlan<T> {
  // --- Турниры
  const knownTournaments = new Map<string, string>();

  for (const slot of [...slots, ...saved]) {
    if (
      slot.purpose === 'TOURNAMENT' &&
      slot.tournamentId &&
      slot.tournamentTypeId &&
      !knownTournaments.has(slot.tournamentTypeId)
    ) {
      knownTournaments.set(slot.tournamentTypeId, slot.tournamentId);
    }
  }

  const tournaments: DayEventsPlan<T>['tournaments'] = [];
  const tournamentIndex = new Map<string, number>();

  const tournamentOf = (slot: T): EventRef | null => {
    if (slot.purpose !== 'TOURNAMENT') return null;
    if (slot.tournamentId) return { id: slot.tournamentId };

    const typeId = slot.tournamentTypeId;

    if (!typeId) return null;

    const known = knownTournaments.get(typeId);

    if (known) return { id: known };

    const index = tournamentIndex.get(typeId);

    if (index === undefined) {
      tournamentIndex.set(typeId, tournaments.length);
      tournaments.push({ tournamentTypeId: typeId, startMinute: slot.startMinute, endMinute: slot.endMinute });

      return { create: tournaments.length - 1 };
    }

    const planned = tournaments[index]!;

    planned.startMinute = Math.min(planned.startMinute, slot.startMinute);
    planned.endMinute = Math.max(planned.endMinute, slot.endMinute);

    return { create: index };
  };

  // --- Занятия
  const pairOf = (slot: ClosureSlot): string => `${slot.trainingTypeId}|${slot.coachId}`;
  const pending = slots
    .map((slot, index) => ({ slot, index }))
    .filter(
      ({ slot }) =>
        slot.purpose === 'TRAINING' &&
        slot.trainingSessionId === NEW_SESSION &&
        slot.trainingTypeId !== null &&
        slot.coachId !== null,
    );
  const anchors = [...slots, ...saved].filter(
    (slot) => slot.purpose === 'TRAINING' && slot.trainingSessionId && slot.trainingSessionId !== NEW_SESSION,
  );

  const sessions: DayEventsPlan<T>['sessions'] = [];
  const sessionOfPending = new Map<number, EventRef>();

  for (const pair of new Set(pending.map(({ slot }) => pairOf(slot)))) {
    const own = pending.filter(({ slot }) => pairOf(slot) === pair);
    const ownAnchors = anchors.filter((anchor) => pairOf(anchor) === pair);

    // Связные отрезки — объединением по соприкосновению во времени, без
    // оглядки на стол: группа на четырёх столах — одна группа.
    const parent = own.map((_, index) => index);
    const root = (index: number): number => {
      let at = index;

      while (parent[at] !== at) at = parent[at]!;

      return at;
    };

    for (let a = 0; a < own.length; a += 1) {
      for (let b = a + 1; b < own.length; b += 1) {
        if (touches(own[a]!.slot, own[b]!.slot)) parent[root(a)] = root(b);
      }
    }

    const groups = new Map<number, number[]>();

    own.forEach((_, index) => {
      groups.set(root(index), [...(groups.get(root(index)) ?? []), index]);
    });

    for (const members of groups.values()) {
      // Заведённые занятия, к которым отрезок примыкает, — по суммарному
      // перекрытию; поровну — то, что начинается раньше.
      const score = new Map<string, { overlap: number; start: number }>();

      for (const member of members) {
        for (const anchor of ownAnchors) {
          if (!touches(own[member]!.slot, anchor)) continue;

          const id = anchor.trainingSessionId!;
          const current = score.get(id) ?? { overlap: 0, start: anchor.startMinute };

          score.set(id, {
            overlap: current.overlap + overlapMinutes(own[member]!.slot, anchor),
            start: Math.min(current.start, anchor.startMinute),
          });
        }
      }

      const best = [...score.entries()].sort(
        ([idA, a], [idB, b]) => b.overlap - a.overlap || a.start - b.start || idA.localeCompare(idB),
      )[0];

      let ref: EventRef;

      if (best) {
        ref = { id: best[0] };
      } else {
        const first = own[members[0]!]!.slot;

        sessions.push({
          trainingTypeId: first.trainingTypeId!,
          coachId: first.coachId!,
          startMinute: Math.min(...members.map((member) => own[member]!.slot.startMinute)),
          endMinute: Math.max(...members.map((member) => own[member]!.slot.endMinute)),
        });
        ref = { create: sessions.length - 1 };
      }

      for (const member of members) sessionOfPending.set(own[member]!.index, ref);
    }
  }

  const sessionOf = (slot: T, index: number): EventRef | null => {
    if (slot.purpose !== 'TRAINING' || !slot.trainingSessionId) return null;
    if (slot.trainingSessionId !== NEW_SESSION) return { id: slot.trainingSessionId };

    return sessionOfPending.get(index) ?? null;
  };

  return {
    tournaments,
    sessions,
    slots: slots.map((slot, index) => ({
      slot,
      tournament: tournamentOf(slot),
      session: sessionOf(slot, index),
    })),
  };
}

/** Промежуток клеток одного стола: `[from, to)`. */
export interface SlotRange {
  tableId: string;
  from: number;
  to: number;
}

/**
 * Что выбрано под бронь после протяжки или щелчка кистью аренды с клиентом.
 *
 * Щелчок, а не только протяжка (решение от 05.10.2026, как в сетке брони
 * клиента): на телефоне протяжка вниз прокручивает сетку, и отрезок длиннее
 * клетки там иначе не выбрать.
 *
 * - протяжка — ровно протянутое;
 * - щелчок — минимальная бронь (`minSlots`) от этой клетки;
 * - щелчок ниже начала выбранного на том же столе — конец отрезка там;
 * - щелчок по началу выбранного — выбор снимается.
 *
 * Отрезок обрезается на первой занятой бронью клетке: сквозь чужую бронь
 * сервер всё равно не посадит, и узнать об этом лучше до «Посадить».
 */
export function seatAfterPick(
  current: SlotRange | null,
  pick: SlotRange,
  minSlots: number,
  busy: (tableId: string, slot: number) => boolean,
): SlotRange | null {
  const tap = pick.to - pick.from === 1;
  let next: SlotRange;

  if (tap && current && current.tableId === pick.tableId && pick.from === current.from) {
    return null;
  }

  if (tap && current && current.tableId === pick.tableId && pick.from > current.from) {
    next = { tableId: pick.tableId, from: current.from, to: pick.from + 1 };
  } else if (tap) {
    next = { tableId: pick.tableId, from: pick.from, to: pick.from + minSlots };
  } else {
    next = pick;
  }

  if (busy(next.tableId, next.from)) {
    return null;
  }

  let to = next.from + 1;

  while (to < Math.min(next.to, SLOTS_PER_DAY) && !busy(next.tableId, to)) {
    to += 1;
  }

  return { tableId: next.tableId, from: next.from, to };
}

/**
 * Чем окно — одно мероприятие: занятием или турниром, а если их ещё нет (окно
 * шаблона, только что закрашенное) — видом, типом и тренером. Аренда, робот,
 * спарринг и прочее — `null`: две брони рядом — две разные брони, и склеивать
 * их значило бы соврать (то же правило, что `blockSpans` в сетке брони).
 */
export function eventKey(value: CellValue): string | null {
  if (value.purpose === 'TRAINING') {
    if (value.trainingSessionId && value.trainingSessionId !== NEW_SESSION) {
      return `session:${value.trainingSessionId}`;
    }

    const state = value.trainingSessionId === NEW_SESSION ? 'new' : 'none';

    return `training:${state}|${value.trainingTypeId}|${value.coachId}`;
  }

  if (value.purpose === 'TOURNAMENT') {
    return value.tournamentId ? `tournament:${value.tournamentId}` : `cup:${value.tournamentTypeId}`;
  }

  return null;
}

/** Прямоугольник мероприятия в сетке расписания: столы `[firstTable, lastTable]`, клетки `[from, to)`. */
export interface CellBlock {
  key: string;
  value: CellValue;
  firstTable: number;
  lastTable: number;
  from: number;
  to: number;
}

/**
 * Мероприятия дорожки — прямоугольниками (решение от 05.10.2026, как в сетке
 * брони с 01.10): группа на столах 1 и 2 с 18:00 до 19:00 — один блок, а не
 * два столбца клеток с одинаковой подписью.
 *
 * Сливаются клетки одного стола подряд с тем же мероприятием (`eventKey`) и
 * соседние столы с тем же мероприятием в ТО ЖЕ время. Разное время на соседних
 * столах — разные блоки: прямоугольник с зубцом соврал бы о границах.
 */
export function cellBlocks(cells: Cells, lane: string, tableIds: readonly string[]): CellBlock[] {
  const blocks: CellBlock[] = [];
  // Открытые для продолжения на следующий стол: ключ — мероприятие и клетки.
  let open = new Map<string, CellBlock>();

  tableIds.forEach((tableId, tableIndex) => {
    const next = new Map<string, CellBlock>();
    let slot = 0;

    while (slot < SLOTS_PER_DAY) {
      const value = cells.get(cellKey(lane, tableId, slot));
      const key = value ? eventKey(value) : null;

      if (!value || key === null) {
        slot += 1;
        continue;
      }

      let to = slot + 1;

      while (to < SLOTS_PER_DAY) {
        const following = cells.get(cellKey(lane, tableId, to));

        if (!following || eventKey(following) !== key) break;

        to += 1;
      }

      const spanKey = `${key}|${slot}|${to}`;
      const previous = open.get(spanKey);

      if (previous && previous.lastTable === tableIndex - 1) {
        previous.lastTable = tableIndex;
        next.set(spanKey, previous);
      } else {
        const block: CellBlock = { key, value, firstTable: tableIndex, lastTable: tableIndex, from: slot, to };

        blocks.push(block);
        next.set(spanKey, block);
      }

      slot = to;
    }

    open = next;
  });

  return blocks;
}

/**
 * Окна дня, на которые кнопка «Открыть запись» заведёт занятия (решение от
 * 05.10.2026): тренировки без занятия — ровно те, что в сетке заштрихованы
 * «без записи». Метка та же, что ставит кисть, — дальше их ведёт
 * `planDayEvents`, и группа на четырёх столах становится одним занятием.
 *
 * Только с действующим типом и тренером клуба: занятие снятого с продажи вида
 * или ушедшего тренера сервер не заведёт, и такое окно уронило бы весь день.
 * Остальные окна возвращаются как есть — турниры из шаблона заводятся при
 * сохранении дня и без метки.
 */
export function markForOpening<T extends ClosureSlot>(
  slots: readonly T[],
  usable: { trainingTypeIds: ReadonlySet<string>; coachIds: ReadonlySet<string> },
): T[] {
  return slots.map((slot) =>
    slot.purpose === 'TRAINING' &&
    slot.trainingSessionId === null &&
    slot.trainingTypeId !== null &&
    slot.coachId !== null &&
    usable.trainingTypeIds.has(slot.trainingTypeId) &&
    usable.coachIds.has(slot.coachId)
      ? { ...slot, trainingSessionId: NEW_SESSION }
      : slot,
  );
}
