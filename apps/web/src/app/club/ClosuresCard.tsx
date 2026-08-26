'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClosureRule, ClubTable, Weekday } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  cellKey,
  cellsToRules,
  copyDay,
  countClosedSlots,
  rulesToCells,
  slotLabel,
  SLOTS_PER_DAY,
  WEEKDAYS,
  WORKDAYS,
} from '@/lib/closureGrid';

/** Строка, с которой прокрутка открывается: до восьми утра залы обычно закрыты. */
const FIRST_VISIBLE_SLOT = 16;

/**
 * Недельное расписание закрытых столов.
 *
 * Закрашенная клетка означает «этот стол в это время клиент забронировать не
 * может». Администратор может — закрытое время закрыто только для
 * самостоятельной онлайн-брони.
 *
 * Правится мышью по клеткам, а не списком интервалов: «с 13:00 до 14:00
 * свободны только столы 3, 4 и 5» в списке набирается пятью строками, а в
 * сетке — одним движением.
 */
export function ClosuresCard({
  tables,
  initial,
}: {
  tables: ClubTable[];
  initial: ClosureRule[];
}) {
  const [cells, setCells] = useState<Set<string>>(() => rulesToCells(initial));
  const [saved, setSaved] = useState<Set<string>>(() => rulesToCells(initial));
  const [weekday, setWeekday] = useState<Weekday>(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const tableIds = useMemo(() => tables.map((table) => table.id), [tables]);
  const dirty = useMemo(() => !sameCells(cells, saved), [cells, saved]);

  /**
   * Что делает перетаскивание — закрывает или открывает.
   *
   * Решается по первой клетке: если начали с открытой, тянем закрытие, если с
   * закрытой — стирание. Так же ведёт себя выделение в таблицах, и другого
   * поведения здесь никто не ждёт.
   */
  const painting = useRef<boolean | null>(null);

  useEffect(() => {
    const stop = (): void => {
      painting.current = null;
    };

    // Кнопку мыши могли отпустить за пределами таблицы — без этого закраска
    // «залипла» бы и продолжилась при следующем наведении.
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);

    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, []);

  function paint(tableId: string, slot: number, closing: boolean): void {
    setSaved((previous) => previous); // состояние сохранённого не трогаем
    setCells((previous) => {
      const key = cellKey(weekday, tableId, slot);
      const next = new Set(previous);

      if (closing) {
        next.add(key);
      } else {
        next.delete(key);
      }

      return next;
    });
    setError(null);
  }

  function clearDay(): void {
    setCells((previous) => {
      const next = new Set(previous);

      for (const key of previous) {
        if (key.startsWith(`${weekday}|`)) {
          next.delete(key);
        }
      }

      return next;
    });
  }

  async function save(): Promise<void> {
    setError(null);
    setPending(true);

    try {
      const rules = await api.replaceClosureRules(cellsToRules(cells, tableIds));
      // Пересобираем из ответа сервера: так видно, что именно легло в базу,
      // и склейка окон на экране совпадает с хранимой.
      const applied = rulesToCells(rules);
      setCells(applied);
      setSaved(applied);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен, попробуйте позже');
    } finally {
      setPending(false);
    }
  }

  if (tables.length === 0) {
    return (
      <Card>
        <CardHeader title="Когда столы закрыты" />
        <CardBody>
          <p className="text-[0.9375rem] text-text-muted">
            Сначала заведите столы — закрывать пока нечего.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Когда столы закрыты"
        description="Закрашенное время клиент не увидит в сетке и забронировать не сможет. Администратор — сможет: жизнь в зале всегда сложнее расписания."
      />
      <CardBody>
        {error && <Alert>{error}</Alert>}

        <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="День недели">
          {WEEKDAYS.map((day) => {
            const closed = countClosedSlots(cells, day.value);

            return (
              <button
                key={day.value}
                type="button"
                role="tab"
                aria-selected={weekday === day.value}
                onClick={() => setWeekday(day.value)}
                className={cn(
                  'rounded-control border px-3 py-1.5 text-[0.875rem] transition-colors',
                  weekday === day.value
                    ? 'border-border-accent bg-surface-accent-soft text-text-accent'
                    : 'border-border text-text-muted hover:bg-surface-sunken',
                )}
              >
                {day.short}
                {closed > 0 && (
                  <span className="ml-1.5 text-[0.75rem] opacity-70">{closed}</span>
                )}
              </button>
            );
          })}
        </div>

        <Grid
          tables={tables}
          weekday={weekday}
          cells={cells}
          painting={painting}
          onPaint={paint}
        />

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setCells(copyDay(cells, weekday, WORKDAYS, tableIds))}
          >
            Скопировать на все будни
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              setCells(
                copyDay(
                  cells,
                  weekday,
                  WEEKDAYS.map((day) => day.value),
                  tableIds,
                ),
              )
            }
          >
            На всю неделю
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={clearDay}>
            Очистить день
          </Button>

          <span className="ml-auto flex items-center gap-3">
            {dirty && (
              <span className="text-[0.8125rem] text-text-subtle">Есть несохранённые правки</span>
            )}
            <Button type="button" pending={pending} disabled={!dirty} onClick={() => void save()}>
              Сохранить расписание
            </Button>
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

/** Таблица «время × столы» одного дня. */
function Grid({
  tables,
  weekday,
  cells,
  painting,
  onPaint,
}: {
  tables: ClubTable[];
  weekday: Weekday;
  cells: ReadonlySet<string>;
  painting: { current: boolean | null };
  onPaint: (tableId: string, slot: number, closing: boolean) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Прокрутка к утру: ночные часы в сетке есть (иначе правило на ночь было
    // бы не видно и не правимо), но открывать на них незачем.
    const row = scroller.current?.querySelector<HTMLElement>(`[data-slot="${FIRST_VISIBLE_SLOT}"]`);

    if (row && scroller.current) {
      scroller.current.scrollTop = row.offsetTop - 1;
    }
  }, []);

  return (
    <div
      ref={scroller}
      className="max-h-[26rem] touch-pan-y overflow-auto rounded-control border border-border"
    >
      <table className="w-full border-collapse text-[0.8125rem] select-none">
        <thead className="sticky top-0 z-10 bg-surface-raised">
          <tr>
            <th className="w-16 border-b border-border p-2 text-left font-medium text-text-subtle">
              Время
            </th>
            {tables.map((table) => (
              <th
                key={table.id}
                className="border-b border-l border-border p-2 font-medium text-text-muted"
                title={table.label}
              >
                <span className="block truncate">{table.label}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: SLOTS_PER_DAY }, (_, slot) => (
            <tr key={slot} data-slot={slot}>
              <th
                scope="row"
                className={cn(
                  'border-b border-border p-1.5 text-left font-normal whitespace-nowrap',
                  // Ровный час выделен: по получасовым подписям взгляд скользит,
                  // и найти «15:00» в тридцати одинаковых строках трудно.
                  slot % 2 === 0 ? 'text-text-muted' : 'text-text-subtle/60',
                )}
              >
                {slotLabel(slot)}
              </th>

              {tables.map((table) => {
                const closed = cells.has(cellKey(weekday, table.id, slot));

                return (
                  <td key={table.id} className="border-b border-l border-border p-0">
                    <button
                      type="button"
                      aria-pressed={closed}
                      aria-label={`${table.label}, ${slotLabel(slot)} — ${closed ? 'закрыт' : 'открыт'}`}
                      onPointerDown={(event) => {
                        // Захват мешает pointerenter на соседних клетках: без
                        // снятия все события уходили бы в первую. Проверка
                        // обязательна — снятие незахваченного указателя
                        // бросает NotFoundError.
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                          event.currentTarget.releasePointerCapture(event.pointerId);
                        }

                        painting.current = !closed;
                        onPaint(table.id, slot, !closed);
                      }}
                      onPointerEnter={() => {
                        if (painting.current !== null) {
                          onPaint(table.id, slot, painting.current);
                        }
                      }}
                      className={cn(
                        'block h-7 w-full transition-colors',
                        closed
                          ? 'bg-accent/70 hover:bg-accent/85'
                          : 'hover:bg-surface-sunken',
                      )}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function sameCells(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }

  for (const key of a) {
    if (!b.has(key)) {
      return false;
    }
  }

  return true;
}
