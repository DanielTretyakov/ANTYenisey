'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ClubTable } from '@yenisey/types';
import { shortName } from '@yenisey/types';
import { formatMinute } from '@/lib/bookingGrid';
import {
  cellKey,
  GRID_END_MINUTE,
  GRID_START_MINUTE,
  personOf,
  SLOT_MINUTES,
  slotLabel,
  SLOTS_PER_DAY,
  type CellValue,
  type Cells,
} from '@/lib/closureGrid';
import { cn } from '@/lib/cn';
import type { PersonColor } from '@/lib/personColor';
import { PURPOSE_CELL, PURPOSE_LABEL, PURPOSE_MARK } from './SchedulePalette';

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
/** Промежуток, выделяемый протяжкой: клетки одного стола подряд. */
interface Range {
  tableId: string;
  from: number;
  to: number;
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
  cells,
  booked,
  nameOf,
  captionOf,
  colors,
  painting,
  brushValue,
  onPaint,
  onRange,
  nowMinute = null,
}: {
  tables: ClubTable[];
  lane: string;
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
   * Протяжка выделяет промежуток вместо закрашивания клеток.
   *
   * Так работает кисть аренды с выбранным клиентом: закрашивать нечего —
   * из промежутка получится бронь. Пока проп не передан, сетка красит как
   * обычно.
   */
  onRange?: (tableId: string, startSlot: number, endSlot: number) => void;
  /**
   * Который сейчас час в зале — только на сегодняшнем дне. `null` — линии нет:
   * в шаблоне недели «сегодня» не существует, а у вчерашнего дня нет «сейчас».
   */
  nowMinute?: number | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const firstRow = useRef<HTMLTableRowElement>(null);
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

  // Промежуток отдаётся наверх, когда кнопку отпустили, — где угодно, хоть
  // за пределами таблицы: иначе выделение «залипало» бы до следующего клика.
  useEffect(() => {
    if (!onRange) return;

    const done = (): void => {
      const current = rangeRef.current;

      if (!current) return;

      select(null);
      onRange(current.tableId, current.from, current.to + 1);
    };

    window.addEventListener('pointerup', done);
    window.addEventListener('pointercancel', done);

    return () => {
      window.removeEventListener('pointerup', done);
      window.removeEventListener('pointercancel', done);
    };
  }, [onRange]);

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
              {tables.map((table) => (
                <th
                  key={table.id}
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

                {tables.map((table) => (
                  <GridCell
                    key={table.id}
                    table={table}
                    slot={slot}
                    lane={lane}
                    cells={cells}
                    booking={booked?.get(`${table.id}|${slot}`)}
                    nameOf={nameOf}
                    captionOf={captionOf}
                    colors={colors}
                    painting={painting}
                    brushValue={brushValue}
                    onPaint={onPaint}
                    selecting={onRange !== undefined}
                    selected={
                      range !== null &&
                      range.tableId === table.id &&
                      slot >= range.from &&
                      slot <= range.to
                    }
                    onSelectStart={() => select({ tableId: table.id, from: slot, to: slot })}
                    onSelectTo={() => {
                      const current = rangeRef.current;

                      if (current && current.tableId === table.id) {
                        select({ ...current, to: slot });
                      }
                    }}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>

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
  cells,
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
}: {
  table: ClubTable;
  slot: number;
  lane: string;
  cells: Cells;
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
}) {
  const value = cells.get(cellKey(lane, table.id, slot));
  const purposeLabel = value ? PURPOSE_LABEL.get(value.purpose) : 'свободно';
  const personId = value ? personOf(value) : null;
  const person = personId ? nameOf(personId) : null;
  const caption = value ? captionOf(value) : null;
  const color = personId ? colors.get(personId) : undefined;

  // Подпись ставится только там, где окно начинается: иначе четырёхчасовая
  // тренировка повторила бы фамилию восемь раз подряд.
  const above = cells.get(cellKey(lane, table.id, slot - 1));
  const startsHere =
    value !== undefined &&
    (above === undefined || above.purpose !== value.purpose || above.coachId !== value.coachId);

  const needsCoach = value?.purpose === 'TRAINING' && !personId;

  // Цвет человека, если он закреплён; иначе — назначения. Ставится стилем, а не
  // классом: краска вычисляется из палитры и поверхности через color-mix.
  const background = color ? color.cell : value ? PURPOSE_CELL.get(value.purpose) : undefined;

  return (
    <td
      className={cn(
        'border-b border-l border-border p-0 first-of-type:border-l-0',
        slot % 2 === 1 && 'border-b-border-strong',
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
            : `${table.label}, ${slotLabel(slot)} — ${[purposeLabel, caption, person].filter(Boolean).join(', ')}`
        }
        title={
          booking
            ? `Бронь · ${booking.person} — отменить или перенести можно на экране смены`
            : [purposeLabel, caption, person].filter(Boolean).join(' · ')
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
          const same =
            value !== undefined &&
            next !== null &&
            value.purpose === next.purpose &&
            value.coachId === next.coachId;

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
        style={background && !booking ? { background } : undefined}
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

        {!booking && value && (
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

        {!booking && startsHere && (caption || person) && (
          // Сначала чем занято, потом кто ведёт: администратор ищет в сетке
          // занятие, а тренера уже уточняет.
          <span className="truncate">
            {caption}
            {caption && person ? ' · ' : ''}
            {person ? shortName(person) : ''}
          </span>
        )}
        {!booking && startsHere && !caption && !person && value && !needsCoach && (
          <span className="text-text-muted">{purposeLabel}</span>
        )}
        {!booking && startsHere && needsCoach && (
          // Тренировка без тренера не сохранится: сервер её отклонит. Лучше
          // сказать об этом в клетке, чем сообщением после «Сохранить».
          <span className="text-warning">нужен тренер</span>
        )}
      </button>
    </td>
  );
}

/** Кто занят в этой дорожке — с цветами, которыми они закрашены. */
export function ScheduleLegend({
  cells,
  lane,
  nameOf,
  colors,
}: {
  cells: Cells;
  lane: string;
  nameOf: (id: string) => string;
  colors: Map<string, PersonColor>;
}) {
  const ids = new Set<string>();

  for (const [key, value] of cells) {
    if (!key.startsWith(`${lane}|`)) continue;
    const person = personOf(value);
    if (person) ids.add(person);
  }

  if (ids.size === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.8125rem] text-text-muted">
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
