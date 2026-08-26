'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ClosurePurpose,
  ClosureRule,
  ClubCoach,
  ClubTable,
  DayClosure,
  Weekday,
} from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { inputClassName } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  cellKey,
  cellsToSlots,
  copyLane,
  countOnLane,
  sameCells,
  slotLabel,
  slotsToCells,
  SLOTS_PER_DAY,
  splitByGrid,
  WEEKDAYS,
  WORKDAYS,
  type CellValue,
  type Cells,
} from '@/lib/closureGrid';

/** Дорожка расписания даты — она одна, в отличие от семи дорожек шаблона. */
const DAY_LANE = 'day';

/** Кисть «стереть»: отдельное значение, потому что назначением она не является. */
const ERASER = 'ERASE';

type Brush = ClosurePurpose | typeof ERASER;

const PURPOSES: { value: ClosurePurpose; label: string; cell: string; chip: string }[] = [
  {
    value: 'RENT',
    label: 'Аренда',
    cell: 'bg-sky-500/60 hover:bg-sky-500/75',
    chip: 'bg-sky-500/60',
  },
  {
    value: 'SPARRING',
    label: 'Спарринг',
    cell: 'bg-violet-500/60 hover:bg-violet-500/75',
    chip: 'bg-violet-500/60',
  },
  {
    value: 'TRAINING',
    label: 'Тренировка',
    cell: 'bg-accent/70 hover:bg-accent/85',
    chip: 'bg-accent/70',
  },
  {
    value: 'ROBOT',
    label: 'Робот',
    cell: 'bg-amber-500/60 hover:bg-amber-500/75',
    chip: 'bg-amber-500/60',
  },
  {
    value: 'OTHER',
    label: 'Другое',
    cell: 'bg-zinc-500/60 hover:bg-zinc-500/75',
    chip: 'bg-zinc-500/60',
  },
];

const PURPOSE_LABEL = new Map(PURPOSES.map((item) => [item.value, item.label]));
const PURPOSE_CELL = new Map(PURPOSES.map((item) => [item.value, item.cell]));

type Mode = 'template' | 'day';

/**
 * Расписание зала.
 *
 * Два режима на одной сетке. **Шаблон недели** описывает, как зал живёт
 * обычно, — он и есть основная настройка, потому что расписание в основном
 * стабильно. **День** позволяет поправить конкретную дату, не трогая шаблон:
 * правленый день заменяет шаблон целиком, поэтому в нём можно и добавить
 * занятие, и убрать то, что стоит в шаблоне.
 *
 * Занятое время закрыто ТОЛЬКО для клиента: администратор посадить человека за
 * такой стол по-прежнему может. Жизнь в зале всегда сложнее расписания.
 */
export function ScheduleCard({
  hallId,
  tables,
  coaches,
  timezone,
}: {
  hallId: string;
  tables: ClubTable[];
  coaches: ClubCoach[];
  timezone: string;
}) {
  const [mode, setMode] = useState<Mode>('template');
  const [weekday, setWeekday] = useState<Weekday>(1);
  const [date, setDate] = useState(() => todayIn(timezone));

  const [cells, setCells] = useState<Cells>(new Map());
  const [saved, setSaved] = useState<Cells>(new Map());
  /** Ночные окна (до 06:00) в сетку не попадают и уезжают обратно нетронутыми. */
  const [night, setNight] = useState<(ClosureRule | DayClosure)[]>([]);
  const [customised, setCustomised] = useState(false);
  const [customisedDates, setCustomisedDates] = useState<string[]>([]);

  const [brush, setBrush] = useState<Brush>('TRAINING');
  const [coachId, setCoachId] = useState<string | null>(coaches[0]?.id ?? null);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  const own = useMemo(() => tables.filter((table) => table.hallId === hallId), [tables, hallId]);
  const tableIds = useMemo(() => own.map((table) => table.id), [own]);
  const lanes = useMemo(
    () => (mode === 'template' ? WEEKDAYS.map((day) => String(day.value)) : [DAY_LANE]),
    [mode],
  );
  const lane = mode === 'template' ? String(weekday) : DAY_LANE;
  const dirty = !sameCells(cells, saved);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      if (mode === 'template') {
        const rules = await api.template(hallId);
        const split = splitByGrid(rules);
        const next = slotsToCells(split.inGrid, (slot) => String((slot as ClosureRule).weekday));

        setNight(split.night);
        setCells(next);
        setSaved(next);
        setCustomised(false);
      } else {
        const [day, dates] = await Promise.all([
          api.daySchedule(hallId, date),
          api.customisedDates(hallId),
        ]);

        // Неправленый день показывается заполненным по шаблону: администратор
        // правит то, что видит, а не пустую сетку, из которой непонятно, что
        // сегодня вообще происходит.
        const source = day.customised
          ? day.closures
          : (await api.template(hallId)).filter(
              (rule) => rule.weekday === weekdayOf(date),
            );

        const split = splitByGrid(source);
        const next = slotsToCells(split.inGrid, () => DAY_LANE);

        setNight(split.night);
        setCells(next);
        setSaved(day.customised ? next : new Map(next));
        setCustomised(day.customised);
        setCustomisedDates(dates);
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setLoading(false);
    }
  }, [hallId, mode, date]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Что делает перетаскивание — закрашивает или стирает.
   *
   * Решается по первой клетке: начали с занятой тем же, чем красим, — тянем
   * стирание, иначе закраску. Так же ведёт себя выделение в таблицах.
   */
  const painting = useRef<CellValue | null | undefined>(undefined);

  useEffect(() => {
    const stop = (): void => {
      painting.current = undefined;
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

  function brushValue(): CellValue | null {
    if (brush === ERASER) {
      return null;
    }

    // Тренер запоминается только там, где он осмыслен: у аренды и робота поле
    // не просто необязательно, а запрещено — иначе в статистику тренера
    // попадут чужие часы.
    return {
      purpose: brush,
      coachId: brush === 'TRAINING' || brush === 'SPARRING' ? coachId : null,
    };
  }

  function paint(tableId: string, slot: number, value: CellValue | null): void {
    setCells((previous) => {
      const key = cellKey(lane, tableId, slot);
      const next = new Map(previous);

      if (value === null) {
        next.delete(key);
      } else {
        next.set(key, value);
      }

      return next;
    });
    setError(null);
  }

  function clearLane(): void {
    setCells((previous) => {
      const next = new Map(previous);

      for (const key of previous.keys()) {
        if (key.startsWith(`${lane}|`)) {
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
      const slots = cellsToSlots(cells, lanes, tableIds);

      if (mode === 'template') {
        const rules = slots.map(({ lane: laneKey, ...slot }) => ({
          ...slot,
          weekday: Number(laneKey) as Weekday,
        }));

        const stored = await api.replaceTemplate(hallId, [
          ...(night as ClosureRule[]).map(({ id: _id, ...rest }) => rest),
          ...rules,
        ]);

        const split = splitByGrid(stored);
        const next = slotsToCells(split.inGrid, (slot) => String((slot as ClosureRule).weekday));

        setNight(split.night);
        setCells(next);
        setSaved(next);
      } else {
        const closures = slots.map(({ lane: _lane, ...slot }) => slot);

        const stored = await api.replaceDay(hallId, date, [
          ...(night as DayClosure[]).map(({ id: _id, ...rest }) => rest),
          ...closures,
        ]);

        const split = splitByGrid(stored.closures);
        const next = slotsToCells(split.inGrid, () => DAY_LANE);

        setNight(split.night);
        setCells(next);
        setSaved(next);
        setCustomised(true);
        setCustomisedDates((previous) =>
          previous.includes(date) ? previous : [...previous, date].sort(),
        );
      }
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'Сервис недоступен, попробуйте позже',
      );
    } finally {
      setPending(false);
    }
  }

  async function resetDay(): Promise<void> {
    setError(null);
    setPending(true);

    try {
      await api.resetDay(hallId, date);
      setCustomisedDates((previous) => previous.filter((item) => item !== date));
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(false);
    }
  }

  if (own.length === 0) {
    return (
      <Card>
        <CardHeader title="Расписание зала" />
        <CardBody>
          <p className="text-[0.9375rem] text-text-muted">
            Сначала заведите столы — составлять расписание пока не для чего.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Расписание зала"
        description="Закрашенное время клиент не увидит в сетке и забронировать не сможет. Администратор — сможет: жизнь в зале всегда сложнее расписания."
      />
      <CardBody>
        {error && <Alert>{error}</Alert>}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <ModeTab active={mode === 'template'} onClick={() => setMode('template')}>
            Шаблон недели
          </ModeTab>
          <ModeTab active={mode === 'day'} onClick={() => setMode('day')}>
            Отдельный день
          </ModeTab>

          {mode === 'day' && (
            <>
              <input
                type="date"
                aria-label="Дата расписания"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className={cn(inputClassName, 'h-9 w-auto py-1 text-[0.875rem]')}
              />
              <span className="text-[0.8125rem] text-text-subtle">
                {customised
                  ? 'День отличается от шаблона'
                  : 'Заполнено по шаблону — сохраните, чтобы отвязать этот день'}
              </span>
            </>
          )}
        </div>

        {mode === 'template' && (
          <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="День недели">
            {WEEKDAYS.map((day) => {
              const count = countOnLane(cells, String(day.value));

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
                  {count > 0 && <span className="ml-1.5 text-[0.75rem] opacity-70">{count}</span>}
                </button>
              );
            })}
          </div>
        )}

        <Palette
          brush={brush}
          onBrush={setBrush}
          coaches={coaches}
          coachId={coachId}
          onCoach={setCoachId}
        />

        {loading ? (
          <div className="h-64 animate-pulse rounded-control border border-border bg-surface-sunken" />
        ) : (
          <Grid
            tables={own}
            lane={lane}
            cells={cells}
            coaches={coaches}
            painting={painting}
            brushValue={brushValue}
            onPaint={paint}
          />
        )}

        {night.length > 0 && (
          <p className="mt-3 text-[0.8125rem] text-text-subtle">
            Ещё {night.length} {plural(night.length, 'окно', 'окна', 'окон')} заведено до 06:00 — в
            таблице их нет, но при сохранении они остаются нетронутыми.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {mode === 'template' && (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  setCells(copyLane(cells, lane, WORKDAYS.map(String), tableIds))
                }
              >
                Скопировать на все будни
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  setCells(
                    copyLane(cells, lane, WEEKDAYS.map((day) => String(day.value)), tableIds),
                  )
                }
              >
                На всю неделю
              </Button>
            </>
          )}

          {mode === 'day' && customised && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => void resetDay()}
            >
              Вернуть день к шаблону
            </Button>
          )}

          <Button type="button" variant="ghost" size="sm" onClick={clearLane}>
            Очистить {mode === 'template' ? 'день недели' : 'день'}
          </Button>

          <span className="ml-auto flex items-center gap-3">
            {dirty && (
              <span className="text-[0.8125rem] text-text-subtle">Есть несохранённые правки</span>
            )}
            <Button
              type="button"
              pending={pending}
              disabled={!dirty && (mode === 'template' || customised)}
              onClick={() => void save()}
            >
              Сохранить
            </Button>
          </span>
        </div>

        {mode === 'day' && customisedDates.length > 0 && (
          <p className="mt-3 text-[0.8125rem] text-text-subtle">
            Отличаются от шаблона: {customisedDates.slice(0, 12).join(', ')}
            {customisedDates.length > 12 && ` и ещё ${customisedDates.length - 12}`}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-control border px-3.5 py-1.5 text-[0.875rem] transition-colors',
        active
          ? 'border-border-accent bg-surface-accent-soft text-text-accent'
          : 'border-border text-text-muted hover:bg-surface-sunken',
      )}
    >
      {children}
    </button>
  );
}

/** Выбор кисти: чем закрашивать и, для занятий, кто их ведёт. */
function Palette({
  brush,
  onBrush,
  coaches,
  coachId,
  onCoach,
}: {
  brush: Brush;
  onBrush: (brush: Brush) => void;
  coaches: ClubCoach[];
  coachId: string | null;
  onCoach: (id: string | null) => void;
}) {
  const needsCoach = brush === 'TRAINING' || brush === 'SPARRING';

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {PURPOSES.map((purpose) => (
        <button
          key={purpose.value}
          type="button"
          aria-pressed={brush === purpose.value}
          onClick={() => onBrush(purpose.value)}
          className={cn(
            'flex items-center gap-2 rounded-control border px-3 py-1.5 text-[0.875rem] transition-colors',
            brush === purpose.value
              ? 'border-border-strong bg-surface-sunken text-text'
              : 'border-border text-text-muted hover:bg-surface-sunken',
          )}
        >
          <span className={cn('h-3 w-3 rounded-sm', purpose.chip)} aria-hidden="true" />
          {purpose.label}
        </button>
      ))}

      <button
        type="button"
        aria-pressed={brush === ERASER}
        onClick={() => onBrush(ERASER)}
        className={cn(
          'rounded-control border px-3 py-1.5 text-[0.875rem] transition-colors',
          brush === ERASER
            ? 'border-border-strong bg-surface-sunken text-text'
            : 'border-border text-text-muted hover:bg-surface-sunken',
        )}
      >
        Освободить
      </button>

      {needsCoach && (
        <label className="ml-2 flex items-center gap-2 text-[0.875rem] text-text-muted">
          Тренер
          <select
            value={coachId ?? ''}
            onChange={(event) => onCoach(event.target.value || null)}
            className={cn(inputClassName, 'h-9 w-auto py-1 text-[0.875rem]')}
          >
            {/* У тренировки тренер обязателен, у спарринга — нет: спарринг
                заводят заранее, ещё не зная, кто его проведёт. */}
            {brush === 'SPARRING' && <option value="">не назначен</option>}
            {coaches.length === 0 && <option value="">тренеров нет</option>}
            {coaches.map((coach) => (
              <option key={coach.id} value={coach.id}>
                {coach.fullName}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

/** Таблица «время × столы» одной дорожки. */
function Grid({
  tables,
  lane,
  cells,
  coaches,
  painting,
  brushValue,
  onPaint,
}: {
  tables: ClubTable[];
  lane: string;
  cells: Cells;
  coaches: ClubCoach[];
  painting: { current: CellValue | null | undefined };
  brushValue: () => CellValue | null;
  onPaint: (tableId: string, slot: number, value: CellValue | null) => void;
}) {
  const coachName = new Map(coaches.map((coach) => [coach.id, coach.fullName]));

  return (
    <div className="max-h-[26rem] touch-pan-y overflow-auto rounded-control border border-border">
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
            <tr key={slot}>
              <th
                scope="row"
                className={cn(
                  'border-b border-border p-1.5 text-left font-normal whitespace-nowrap',
                  // Ровный час выделен: по получасовым подписям взгляд скользит,
                  // и найти «15:00» в трёх десятках одинаковых строк трудно.
                  slot % 2 === 0 ? 'text-text-muted' : 'text-text-subtle/60',
                )}
              >
                {slotLabel(slot)}
              </th>

              {tables.map((table) => {
                const value = cells.get(cellKey(lane, table.id, slot));
                const label = value ? PURPOSE_LABEL.get(value.purpose) : 'свободно';
                const coach = value?.coachId ? coachName.get(value.coachId) : undefined;

                return (
                  <td key={table.id} className="border-b border-l border-border p-0">
                    <button
                      type="button"
                      aria-pressed={value !== undefined}
                      aria-label={`${table.label}, ${slotLabel(slot)} — ${label}${coach ? `, ${coach}` : ''}`}
                      title={coach ? `${label}: ${coach}` : label}
                      onPointerDown={(event) => {
                        // Захват мешает pointerenter на соседних клетках: без
                        // снятия все события уходили бы в первую. Проверка
                        // обязательна — снятие незахваченного указателя
                        // бросает NotFoundError.
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                          event.currentTarget.releasePointerCapture(event.pointerId);
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
                      onPointerEnter={() => {
                        if (painting.current !== undefined) {
                          onPaint(table.id, slot, painting.current);
                        }
                      }}
                      className={cn(
                        'block h-7 w-full transition-colors',
                        value
                          ? PURPOSE_CELL.get(value.purpose)
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

/** Сегодняшняя дата по времени клуба, а не браузера. */
function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** День недели по ISO-8601 для даты вида «2026-03-12». */
function weekdayOf(date: string): Weekday {
  // getUTCDay даёт 0 для воскресенья; ISO-8601 ждёт 7.
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (day === 0 ? 7 : day) as Weekday;
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;

  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;

  return many;
}
