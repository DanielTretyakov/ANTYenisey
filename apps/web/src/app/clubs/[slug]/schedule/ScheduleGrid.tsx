'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ClubTable } from '@yenisey/types';
import { shortName } from '@yenisey/types';
import { formatMinute } from '@/lib/bookingGrid';
import {
  cellBlocks,
  cellKey,
  GRID_END_MINUTE,
  GRID_START_MINUTE,
  matchesBrush,
  personOf,
  sameKind,
  SLOT_MINUTES,
  slotLabel,
  SLOTS_PER_DAY,
  type CellBlock,
  type CellValue,
  type Cells,
  type SlotRange,
} from '@/lib/closureGrid';
import { cn } from '@/lib/cn';
import type { PersonColor } from '@/lib/personColor';
import { PURPOSE_CELL, PURPOSE_CHIP, PURPOSE_LABEL, PURPOSE_MARK } from './SchedulePalette';

/**
 * Таблица «время × столы» одной дорожки.
 *
 * Цвет клетки — это ЧЕЛОВЕК, а не назначение: тренеров и арендаторов в
 * расписании десятки, и различать их по подписи тяжело, а назначений всего
 * пять и они подписаны буквой. Назначение при этом не теряется — оно в букве
 * слева и в подписи окна.
 *
 * Размеры выбраны под отдельный экран, а не под карточку в настройках, где
 * сетка жила раньше: строка 36 пикселей вместо 28, подпись 13 вместо 11, и
 * таблица занимает высоту окна, а не 26rem — прежние 26rem показывали 13
 * строк из 36, меньше половины вечера.
 */
/**
 * Бронь в сетке: клетка, занятая человеком, а не планом клуба.
 *
 * Ключ карты — `tableId|slot`, как у клеток расписания.
 */
/** Промежуток, выделяемый протяжкой: клетки одного стола подряд, `to` включительно. */
interface Range {
  tableId: string;
  from: number;
  to: number;
}

/**
 * Сколько строк под концом выбранного должно остаться, чтобы карточка
 * встала ниже него. Меньше — встаёт над началом: у полуночи ей вниз некуда.
 */
const PANEL_ROWS_BELOW = 6;

/**
 * Штриховка окна тренировки без занятия — «стол закрыт, но записи нет».
 *
 * Не подписью: в узкой колонке подпись обрезается раньше, чем до неё доходит
 * дело, и пометка «без записи» пропадала ровно там, где столов много.
 */
const NO_BOOKING_STRIPES =
  'repeating-linear-gradient(135deg, transparent 0 7px, color-mix(in oklab, var(--text) 13%, transparent) 7px 9px)';

/** Где лежат строки и столбцы — чтобы положить блок мероприятия поверх клеток. */
interface Geometry {
  /** Верх первой строки от верха сетки. */
  top: number;
  /** Высота строки. */
  row: number;
  columns: { left: number; width: number }[];
}

export interface BookedCell {
  /** Кого посадили — показывается в первой клетке брони. */
  person: string;
  /** Первая клетка брони: подпись ставится только в ней. */
  startsHere: boolean;
}

export function ScheduleGrid({
  tables,
  lane,
  day = false,
  cells,
  booked,
  nameOf,
  captionOf,
  colors,
  painting,
  brushValue,
  onPaint,
  onPick,
  seat = null,
  seatPanel,
  nowMinute = null,
}: {
  tables: ClubTable[];
  lane: string;
  /** Расписание даты: окна тренировок без занятия помечаются «без записи». */
  day?: boolean;
  cells: Cells;
  /**
   * Брони этого дня. Сетка их только показывает: бронь — это чужие деньги и
   * договорённость с человеком, её не стирают кистью. Без них закрашивание
   * поверх брони выглядело бы удавшимся, а сервер потом отказывал.
   */
  booked?: Map<string, BookedCell>;
  nameOf: (id: string) => string;
  /** Чем занято окно: название занятия или турнира. */
  captionOf: (value: CellValue) => string | null;
  colors: Map<string, PersonColor>;
  painting: { current: CellValue | null | undefined };
  brushValue: () => CellValue | null;
  onPaint: (tableId: string, slot: number, value: CellValue | null) => void;
  /**
   * Протяжка или щелчок выделяет промежуток вместо закрашивания клеток.
   *
   * Так работает кисть аренды с выбранным клиентом: закрашивать нечего —
   * из промежутка получится бронь. Пока проп не передан, сетка красит как
   * обычно. Промежуток — `[from, to)`, сверху вниз, как бы ни тянули.
   */
  onPick?: (pick: SlotRange) => void;
  /** Выбранное под бронь: подсвечено, пока администратор не решил. */
  seat?: SlotRange | null;
  /**
   * Карточка решения по выбранному — рядом с ним, а не под сеткой (решение
   * от 05.10.2026: подтверждение аренды уезжало на экран вниз, и до него
   * приходилось листать).
   */
  seatPanel?: ReactNode;
  /**
   * Который сейчас час в зале — только на сегодняшнем дне. `null` — линии нет:
   * в шаблоне недели «сегодня» не существует, а у вчерашнего дня нет «сейчас».
   */
  nowMinute?: number | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const firstRow = useRef<HTMLTableRowElement>(null);
  const headerCells = useRef<(HTMLTableCellElement | null)[]>([]);
  /** Что выделено протяжкой — только в режиме промежутка. */
  const [range, setRange] = useState<Range | null>(null);
  /**
   * То же выделение зеркалом в ref.
   *
   * Обработчик `pointerup` вешается один раз и в замыкании видел бы пустое
   * выделение. Читать его из функции-обновления `setRange` нельзя: она обязана
   * быть чистой, а вызов родителя оттуда даёт «Cannot update a component while
   * rendering a different component» — React жалуется справедливо.
   */
  const rangeRef = useRef<Range | null>(null);

  const select = (next: Range | null): void => {
    rangeRef.current = next;
    setRange(next);
  };
  const [lineTop, setLineTop] = useState<number | null>(null);
  const [bodyTop, setBodyTop] = useState(0);

  const showLine =
    nowMinute !== null && nowMinute >= GRID_START_MINUTE && nowMinute < GRID_END_MINUTE;

  // Положение линии не считается из констант, а измеряется: высоты строк
  // заданы классами, и расчёт по числам разошёлся бы с ними на первой же правке
  // размеров.
  useLayoutEffect(() => {
    const measure = (): void => {
      const row = firstRow.current;

      if (!row || !showLine || nowMinute === null) {
        setLineTop(null);
        return;
      }

      setBodyTop(row.offsetTop);
      setLineTop(
        row.offsetTop + ((nowMinute - GRID_START_MINUTE) / SLOT_MINUTES) * row.offsetHeight,
      );
    };

    measure();

    const observer = new ResizeObserver(measure);

    if (scroller.current) observer.observe(scroller.current);

    return () => observer.disconnect();
  }, [nowMinute, showLine, tables.length]);

  // --- Мероприятия блоками -------------------------------------------------
  //
  // Занятие и турнир рисуются прямоугольником поверх своих клеток (решение от
  // 05.10.2026): группа на столах 1 и 2 — один блок с одной подписью. Блок не
  // ловит указатель — кисть по-прежнему красит и стирает клетки под ним, а
  // склейку пересчитывает `cellBlocks` после каждого мазка.
  const blocks = useMemo(() => cellBlocks(cells, lane, tables.map((table) => table.id)), [cells, lane, tables]);
  const covered = useMemo(() => {
    const keys = new Set<string>();

    for (const block of blocks) {
      for (let index = block.firstTable; index <= block.lastTable; index += 1) {
        for (let slot = block.from; slot < block.to; slot += 1) keys.add(`${tables[index]!.id}|${slot}`);
      }
    }

    return keys;
  }, [blocks, tables]);

  const [geometry, setGeometry] = useState<Geometry | null>(null);

  // Положение измеряется, а не считается из классов — как у линии «сейчас».
  useLayoutEffect(() => {
    const measure = (): void => {
      const box = wrapper.current?.getBoundingClientRect();
      const row = firstRow.current?.getBoundingClientRect();

      if (!box || !row) {
        setGeometry(null);
        return;
      }

      setGeometry({
        top: row.top - box.top,
        row: row.height,
        columns: tables.map((_, index) => {
          const cell = headerCells.current[index]?.getBoundingClientRect();

          return cell ? { left: cell.left - box.left, width: cell.width } : { left: 0, width: 0 };
        }),
      });
    };

    measure();

    const observer = new ResizeObserver(measure);

    if (wrapper.current) observer.observe(wrapper.current);

    return () => observer.disconnect();
  }, [tables]);

  // Промежуток отдаётся наверх, когда кнопку отпустили, — где угодно, хоть
  // за пределами таблицы: иначе выделение «залипало» бы до следующего клика.
  // Протянутое снизу вверх разворачивается: начало — всегда верхняя клетка.
  useEffect(() => {
    if (!onPick) return;

    const done = (): void => {
      const current = rangeRef.current;

      if (!current) return;

      select(null);
      onPick({
        tableId: current.tableId,
        from: Math.min(current.from, current.to),
        to: Math.max(current.from, current.to) + 1,
      });
    };

    window.addEventListener('pointerup', done);
    window.addEventListener('pointercancel', done);

    return () => {
      window.removeEventListener('pointerup', done);
      window.removeEventListener('pointercancel', done);
    };
  }, [onPick]);

  // Карточка решения сама показывается целиком: щелчок у нижнего края окна
  // иначе открыл бы её за краем, и пришлось бы снова листать.
  const panel = useRef<HTMLDivElement>(null);
  const seatKey = seat ? `${seat.tableId}|${seat.from}|${seat.to}` : null;

  useEffect(() => {
    if (seatKey) panel.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [seatKey]);

  const seatIndex = seat ? tables.findIndex((table) => table.id === seat.tableId) : -1;
  const panelBelow = seat !== null && seat.to <= SLOTS_PER_DAY - PANEL_ROWS_BELOW;
  const panelSlot = seat ? (panelBelow ? seat.to - 1 : seat.from) : -1;

  // На сегодняшнем дне сетка один раз прокручивается к текущему часу: иначе
  // администратор каждый раз открывает её на шести утра и крутит до вечера.
  const scrolled = useRef(false);

  useEffect(() => {
    if (scrolled.current || lineTop === null || !scroller.current) return;

    scroller.current.scrollTop = Math.max(lineTop - scroller.current.clientHeight / 3, 0);
    scrolled.current = true;
  }, [lineTop]);

  return (
    <div
      ref={scroller}
      // touch-pan-y, а не touch-auto: горизонтальный пан пальцем отдан под
      // закраску протяжкой — на планшете за стойкой она важнее. По горизонтали
      // прокручивают колесом и полосой. «Починить» на touch-auto значит
      // потерять закраску пальцем.
      className="max-h-[calc(100dvh-19rem)] min-h-[24rem] touch-pan-y overflow-auto rounded-control border border-border bg-surface-raised"
    >
      <div
        ref={wrapper}
        className="relative w-full"
        // Нижняя граница ширины — по числу столов: при двенадцати столах сетка
        // уходит вбок и прокручивается, а не сжимает клетку до нечитаемой.
        style={{ minWidth: `calc(4.5rem + ${tables.length} * 7rem)` }}
      >
        {/* border-separate, а не collapse: при слитых рамках они принадлежат
            таблице, а не ячейке, и закреплённая ячейка уезжает при прокрутке
            без своих границ.

            table-fixed: столбцы столов равной ширины. При автоматической
            раскладке ширину диктует содержимое, и стол с длинной подписью
            «Первая подача (для начинающих) · Спаррингов С.» раздувался вдвое,
            сжимая соседей. */}
        <table className="w-full table-fixed border-separate border-spacing-0 text-[0.8125rem] select-none">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 w-[4.5rem] border-r border-b border-border bg-surface-raised px-2.5 py-2.5 text-left font-medium text-text-subtle">
                Время
              </th>
              {tables.map((table, index) => (
                <th
                  key={table.id}
                  ref={(cell) => {
                    headerCells.current[index] = cell;
                  }}
                  // Левая граница у первого стола снята: её рисует закреплённый
                  // столбец времени, иначе между ними легла бы двойная линия.
                  className="sticky top-0 z-20 min-w-[7rem] border-b border-l border-border bg-surface-raised px-2.5 py-2.5 font-medium text-text-muted [&:nth-child(2)]:border-l-0"
                  title={table.label}
                >
                  <span className="block truncate">{table.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: SLOTS_PER_DAY }, (_, slot) => (
              <tr key={slot} ref={slot === 0 ? firstRow : undefined}>
                <th
                  scope="row"
                  className={cn(
                    'sticky left-0 z-10 border-r border-b bg-surface-raised px-2.5 text-left font-normal whitespace-nowrap tabular-nums',
                    // Конец часа отбит линией плотнее, а ровный час — подписью
                    // темнее: по одинаковым получасовым строкам взгляд скользит,
                    // и найти «19:00» среди тридцати шести трудно.
                    slot % 2 === 1 ? 'border-b-border-strong' : 'border-b-border',
                    slot % 2 === 0 ? 'text-text-muted' : 'text-text-subtle/70',
                  )}
                >
                  {slot % 2 === 0 ? slotLabel(slot) : <span className="text-[0.75rem]">{slotLabel(slot)}</span>}
                </th>

                {tables.map((table, index) => (
                  <GridCell
                    key={table.id}
                    table={table}
                    slot={slot}
                    lane={lane}
                    day={day}
                    cells={cells}
                    inBlock={covered.has(`${table.id}|${slot}`)}
                    booking={booked?.get(`${table.id}|${slot}`)}
                    nameOf={nameOf}
                    captionOf={captionOf}
                    colors={colors}
                    painting={painting}
                    brushValue={brushValue}
                    onPaint={onPaint}
                    selecting={onPick !== undefined}
                    selected={
                      (range !== null &&
                        range.tableId === table.id &&
                        slot >= Math.min(range.from, range.to) &&
                        slot <= Math.max(range.from, range.to)) ||
                      (range === null &&
                        seat !== null &&
                        seat.tableId === table.id &&
                        slot >= seat.from &&
                        slot < seat.to)
                    }
                    onSelectStart={() => select({ tableId: table.id, from: slot, to: slot })}
                    onSelectTo={() => {
                      const current = rangeRef.current;

                      if (current && current.tableId === table.id) {
                        select({ ...current, to: slot });
                      }
                    }}
                    panel={
                      seatPanel && index === seatIndex && slot === panelSlot ? (
                        <div
                          ref={panel}
                          className={cn(
                            'absolute z-[32] w-[min(24rem,calc(100vw-3rem))]',
                            panelBelow ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
                            // У правых столов карточка открывается влево: иначе
                            // она уходила бы за край сетки.
                            index < tables.length / 2 ? 'left-0' : 'right-0',
                          )}
                        >
                          {seatPanel}
                        </div>
                      ) : null
                    }
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {geometry &&
          blocks.map((block) => (
            <EventBlock
              key={`${block.key}|${block.firstTable}|${block.from}`}
              block={block}
              geometry={geometry}
              day={day}
              tables={tables}
              nameOf={nameOf}
              captionOf={captionOf}
              colors={colors}
            />
          ))}

        {lineTop !== null && nowMinute !== null && (
          <>
            {/* Прошедшее время приглушено: на сегодняшнем дне администратор
                ищет в сетке «что дальше», и утренние окна ему мешают. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 z-[14]"
              style={{
                top: bodyTop,
                height: lineTop - bodyTop,
                background: 'color-mix(in oklab, var(--surface-sunken) 45%, transparent)',
              }}
            />

            {/* pointer-events-none обязателен: без него полоска съедает
                pointerenter строки, и протяжка кисти рвётся ровно на текущем
                часе. aria-hidden — то же время уже есть текстом в шапке. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 z-[15] h-0.5 bg-danger"
              style={{ top: lineTop - 1 }}
            >
              <span className="sticky left-1 -mt-2.5 inline-block rounded-full bg-danger px-1.5 py-px text-[0.6875rem] leading-tight font-medium text-surface-raised tabular-nums">
                {formatMinute(nowMinute)}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function GridCell({
  table,
  slot,
  lane,
  day,
  cells,
  inBlock,
  booking,
  nameOf,
  captionOf,
  colors,
  painting,
  brushValue,
  onPaint,
  selecting,
  selected,
  onSelectStart,
  onSelectTo,
  panel,
}: {
  table: ClubTable;
  slot: number;
  lane: string;
  day: boolean;
  cells: Cells;
  /** Клетка под блоком мероприятия: подпись и буква — у блока, не у клетки. */
  inBlock: boolean;
  booking: BookedCell | undefined;
  nameOf: (id: string) => string;
  captionOf: (value: CellValue) => string | null;
  colors: Map<string, PersonColor>;
  painting: { current: CellValue | null | undefined };
  brushValue: () => CellValue | null;
  onPaint: (tableId: string, slot: number, value: CellValue | null) => void;
  selecting: boolean;
  selected: boolean;
  onSelectStart: () => void;
  onSelectTo: () => void;
  /** Карточка решения по выбранному под бронь — висит у этой клетки. */
  panel: ReactNode;
}) {
  const value = cells.get(cellKey(lane, table.id, slot));
  const purposeLabel = value ? PURPOSE_LABEL.get(value.purpose) : 'свободно';
  const personId = value ? personOf(value) : null;
  const person = personId ? nameOf(personId) : null;
  const caption = value ? captionOf(value) : null;
  const color = personId ? colors.get(personId) : undefined;

  // Подпись ставится только там, где окно начинается: иначе четырёхчасовая
  // тренировка повторила бы фамилию восемь раз подряд. Сравнивается всё, что
  // подписано, — раньше только назначение и тренер, и «Детская» встык с
  // «Первой подачей» того же тренера читалась одним окном.
  const above = cells.get(cellKey(lane, table.id, slot - 1));
  const startsHere =
    value !== undefined &&
    (above === undefined ||
      !sameKind(above, value) ||
      (day && (above.trainingSessionId === null) !== (value.trainingSessionId === null)));

  const needsCoach = value?.purpose === 'TRAINING' && !personId;
  // Окно тренировки без занятия закрывает стол, но записаться на него нельзя:
  // так выглядит день, пришедший из шаблона. Администратор должен это видеть.
  const closedForBooking = day && value?.purpose === 'TRAINING' && value.trainingSessionId === null;

  // Цвет человека, если он закреплён; иначе — назначения. Ставится стилем, а не
  // классом: краска вычисляется из палитры и поверхности через color-mix.
  const background = color ? color.cell : value ? PURPOSE_CELL.get(value.purpose) : undefined;

  return (
    <td
      className={cn(
        'border-b border-l border-border p-0 first-of-type:border-l-0',
        slot % 2 === 1 && 'border-b-border-strong',
        panel !== null && 'relative',
      )}
    >
      <button
        type="button"
        aria-pressed={value !== undefined}
        // Бронь кистью не трогают: за ней человек, цена и право на отмену.
        disabled={booking !== undefined}
        aria-label={
          booking
            ? `${table.label}, ${slotLabel(slot)} — бронь, ${booking.person}`
            : `${table.label}, ${slotLabel(slot)} — ${[purposeLabel, caption, person, closedForBooking && 'без записи'].filter(Boolean).join(', ')}`
        }
        title={
          booking
            ? `Бронь · ${booking.person} — отменить или перенести можно на экране смены`
            : [
                purposeLabel,
                caption,
                person,
                closedForBooking && 'без записи — закрасьте кистью тренировки, чтобы открыть запись',
              ]
                .filter(Boolean)
                .join(' · ')
        }
        onPointerDown={(event) => {
          // Захват мешает pointerenter на соседних клетках: без снятия все
          // события уходили бы в первую. Проверка обязательна — снятие
          // незахваченного указателя бросает NotFoundError.
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }

          if (selecting) {
            onSelectStart();
            return;
          }

          const next = brushValue();
          const same = value !== undefined && next !== null && matchesBrush(value, next);

          painting.current = same ? null : next;
          onPaint(table.id, slot, painting.current);
        }}
        onPointerEnter={(event) => {
          if (selecting) {
            // Кнопка мыши уже отпущена — значит, это просто наведение.
            if (event.buttons > 0) onSelectTo();
            return;
          }

          if (painting.current !== undefined) {
            onPaint(table.id, slot, painting.current);
          }
        }}
        style={
          background && !booking
            ? { backgroundColor: background, backgroundImage: closedForBooking ? NO_BOOKING_STRIPES : undefined }
            : undefined
        }
        className={cn(
          'relative flex h-9 w-full items-center overflow-hidden pr-1.5 pl-7 text-left text-[0.8125rem] leading-none whitespace-nowrap transition-colors',
          // Подпись берёт обычный цвет текста: заливка по построению светлая на
          // светлой теме и тёмная на тёмной, и --text контрастен ей в обеих.
          value && !booking ? 'text-text hover:brightness-110' : '',
          !value && !booking && 'hover:bg-surface-sunken',
          // Бронь — не краска расписания, а чужая договорённость: она
          // заштрихована и не откликается на кисть.
          booking && 'cursor-not-allowed bg-surface-sunken text-text-muted',
          selected && 'ring-2 ring-inset ring-accent',
        )}
      >
        {booking && (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 flex w-5 items-center justify-center text-[0.75rem] font-medium"
            style={{ background: 'color-mix(in oklab, var(--text) 10%, transparent)' }}
          >
            Б
          </span>
        )}

        {booking?.startsHere && <span className="truncate">{shortName(booking.person)}</span>}

        {!booking && value && !inBlock && (
          // Буква назначения, а не вторая цветная полоса: цвет клетки занят
          // человеком, и второй цвет рядом с ним местами сливается.
          <span
            className="absolute inset-y-0 left-0 flex w-5 items-center justify-center text-[0.75rem] font-medium"
            style={{ background: 'color-mix(in oklab, var(--text) 14%, transparent)' }}
            aria-hidden="true"
          >
            {PURPOSE_MARK.get(value.purpose)}
          </span>
        )}

        {!booking && !inBlock && startsHere && (caption || person) && (
          // Сначала чем занято, потом кто ведёт: администратор ищет в сетке
          // занятие, а тренера уже уточняет.
          <span className="truncate">
            {caption}
            {caption && person ? ' · ' : ''}
            {person ? shortName(person) : ''}
            {closedForBooking && <span className="text-text-muted"> · без записи</span>}
          </span>
        )}
        {!booking && !inBlock && startsHere && !caption && !person && value && !needsCoach && (
          <span className="text-text-muted">{purposeLabel}</span>
        )}
        {!booking && !inBlock && startsHere && needsCoach && (
          // Тренировка без тренера не сохранится: сервер её отклонит. Лучше
          // сказать об этом в клетке, чем сообщением после «Сохранить».
          <span className="text-warning">нужен тренер</span>
        )}
      </button>

      {panel}
    </td>
  );
}

/**
 * Занятие или турнир — одним прямоугольником поверх своих клеток.
 *
 * Вид — как у блока в сетке брони: заливка, полоса цвета слева, название
 * шрифтом платформы. Цвет — тренера, если он есть, иначе назначения, как у
 * клеток. Указатель блок пропускает насквозь: кисть работает по клеткам под
 * ним, а подсказку с полным составом показывает сама клетка.
 */
function EventBlock({
  block,
  geometry,
  day,
  tables,
  nameOf,
  captionOf,
  colors,
}: {
  block: CellBlock;
  geometry: Geometry;
  day: boolean;
  tables: ClubTable[];
  nameOf: (id: string) => string;
  captionOf: (value: CellValue) => string | null;
  colors: Map<string, PersonColor>;
}) {
  const { value } = block;
  const first = geometry.columns[block.firstTable];
  const last = geometry.columns[block.lastTable];

  if (!first || !last) return null;

  const personId = personOf(value);
  const color = personId ? colors.get(personId) : undefined;
  const caption = captionOf(value) ?? PURPOSE_LABEL.get(value.purpose) ?? '';
  const coach = personId ? shortName(nameOf(personId)) : null;
  const closedForBooking = day && value.purpose === 'TRAINING' && value.trainingSessionId === null;
  const needsCoach = value.purpose === 'TRAINING' && !personId;
  const time = `${slotLabel(block.from)}–${block.to < SLOTS_PER_DAY ? slotLabel(block.to) : '24:00'}`;
  const tall = block.to - block.from >= 2;
  const tablesLabel =
    block.firstTable === block.lastTable
      ? null
      : `${tables[block.firstTable]!.label} — ${tables[block.lastTable]!.label}`;

  // Блок чуть меньше своих клеток: линии сетки вокруг него остаются видны.
  const inset = 2;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-[5] flex flex-col overflow-hidden rounded-[6px] border-l-[3px] px-2 py-1 text-left leading-snug"
      style={{
        top: geometry.top + block.from * geometry.row + inset,
        height: (block.to - block.from) * geometry.row - inset * 2,
        left: first.left + inset,
        width: last.left + last.width - first.left - inset * 2,
        backgroundColor: color ? color.cell : PURPOSE_CELL.get(value.purpose),
        backgroundImage: closedForBooking ? NO_BOOKING_STRIPES : undefined,
        borderLeftColor: color ? color.dot : PURPOSE_CHIP.get(value.purpose),
      }}
    >
      <span className="truncate font-display text-[0.8125rem] text-text">
        <span className="mr-1.5 text-[0.75rem] font-medium text-text-muted">{PURPOSE_MARK.get(value.purpose)}</span>
        {caption}
        {/* В получасовом блоке второй строки нет — всё встаёт в первую. */}
        {!tall && (coach || closedForBooking) && (
          <span className="font-sans text-[0.75rem] text-text-muted">
            {coach ? ` · ${coach}` : ''}
            {closedForBooking ? ' · без записи' : ''}
          </span>
        )}
        {!tall && needsCoach && <span className="font-sans text-[0.75rem] text-warning"> · нужен тренер</span>}
      </span>
      {tall && (
        <span className="truncate text-[0.75rem] text-text-muted">
          {[coach, time, tablesLabel].filter(Boolean).join(' · ')}
        </span>
      )}
      {tall && needsCoach && <span className="truncate text-[0.75rem] text-warning">нужен тренер</span>}
      {tall && closedForBooking && <span className="truncate text-[0.75rem] text-text-muted">без записи</span>}
    </div>
  );
}

/** Кто занят в этой дорожке — с цветами, которыми они закрашены. */
export function ScheduleLegend({
  cells,
  lane,
  day = false,
  nameOf,
  colors,
}: {
  cells: Cells;
  lane: string;
  /** Расписание даты: объяснить штриховку, если она в сетке есть. */
  day?: boolean;
  nameOf: (id: string) => string;
  colors: Map<string, PersonColor>;
}) {
  const ids = new Set<string>();
  let striped = false;

  for (const [key, value] of cells) {
    if (!key.startsWith(`${lane}|`)) continue;
    const person = personOf(value);
    if (person) ids.add(person);
    if (day && value.purpose === 'TRAINING' && value.trainingSessionId === null) striped = true;
  }

  if (ids.size === 0 && !striped) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.8125rem] text-text-muted">
      {striped && (
        <span className="flex items-center gap-1.5">
          <span
            className="h-3 w-5 rounded-sm border border-border"
            style={{ backgroundImage: NO_BOOKING_STRIPES }}
            aria-hidden="true"
          />
          Тренировка без записи: стол закрыт, записаться нельзя — закрасьте кистью тренировки, чтобы открыть запись
        </span>
      )}
      {[...ids]
        .map((id) => ({ id, name: nameOf(id) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
        .map((person) => (
          <span key={person.id} className="flex items-center gap-1.5">
            <span
              className="h-3 w-3 rounded-sm"
              style={{ background: colors.get(person.id)?.dot }}
              aria-hidden="true"
            />
            {person.name}
          </span>
        ))}
    </div>
  );
}

/** Ночные окна в таблицу не попадают — но и не пропадают. Об этом стоит сказать. */
export function NightNotice({ count }: { count: number }) {
  if (count === 0) return null;

  return (
    <p className="mt-3 text-[0.8125rem] text-text-subtle">
      Ещё {count} {plural(count, 'окно', 'окна', 'окон')} заведено до 06:00 — в таблице их нет,
      но при сохранении они остаются нетронутыми.
    </p>
  );
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;

  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;

  return many;
}
