'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ClosureRule,
  ClubCoach,
  ClubPerson,
  ClubTable,
  DayClosure,
  TournamentType,
  TrainingType,
  Weekday,
} from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { inputClassName } from '@/components/ui/Field';
import type { ClosureSlot } from '@yenisey/types';
import { api, ApiError } from '@/lib/api';
import { zonedToInstant } from '@/lib/timezones';
import { cn } from '@/lib/cn';
import { shortName } from '@/lib/names';
import { personColors, type PersonColor } from '@/lib/personColor';
import {
  attachmentOf,
  ERASER,
  PURPOSE_CELL,
  PURPOSE_MARK,
  PURPOSE_LABEL,
  SchedulePalette,
  type Brush,
} from './SchedulePalette';
import {
  cellKey,
  cellsToSlots,
  copyLane,
  countOnLane,
  personOf,
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
  trainingTypes,
  tournamentTypes,
  timezone,
  onTournamentsChanged,
}: {
  hallId: string;
  tables: ClubTable[];
  coaches: ClubCoach[];
  trainingTypes: TrainingType[];
  tournamentTypes: TournamentType[];
  timezone: string;
  /** Постановка турнира в сетку заводит его — список в разделе устарел. */
  onTournamentsChanged: () => void;
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
  const [client, setClient] = useState<ClubPerson | null>(null);
  const [trainingTypeId, setTrainingTypeId] = useState<string | null>(
    trainingTypes[0]?.id ?? null,
  );
  const [tournamentTypeId, setTournamentTypeId] = useState<string | null>(
    tournamentTypes[0]?.id ?? null,
  );
  /**
   * Имена людей, встречающихся в расписании.
   *
   * Тренеры приходят готовым списком, а клиентов у клуба тысячи — их имена
   * подтягиваются точечно, по идентификаторам из уже загруженных окон.
   */
  const [names, setNames] = useState<Map<string, string>>(new Map());

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

  /** Все, кто встречается в загруженном расписании, плюс тренеры клуба. */
  const peopleInView = useMemo(() => {
    const ids = new Set<string>(coaches.map((coach) => coach.id));

    for (const value of cells.values()) {
      const person = personOf(value);
      if (person) ids.add(person);
    }

    return ids;
  }, [cells, coaches]);

  const colors = useMemo(() => personColors([...peopleInView]), [peopleInView]);

  const nameOf = useCallback(
    (id: string): string =>
      coaches.find((coach) => coach.id === id)?.fullName ?? names.get(id) ?? 'без имени',
    [coaches, names],
  );

  // Имена клиентов, закреплённых за окнами, подтягиваются точечно: тянуть
  // ради них весь список клиентов клуба нельзя — их тысячи.
  useEffect(() => {
    const missing = [...peopleInView].filter(
      (id) => !coaches.some((coach) => coach.id === id) && !names.has(id),
    );

    if (missing.length === 0) {
      return;
    }

    let cancelled = false;

    api
      .people({ ids: missing, limit: missing.length })
      .then((page) => {
        if (cancelled) return;
        setNames((previous) => {
          const next = new Map(previous);
          for (const person of page.items) next.set(person.id, person.fullName);
          return next;
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [peopleInView, coaches, names]);

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

  // Кисть «турнир» в шаблоне недели невозможна: переключаясь туда, оставлять
  // её выбранной значит предлагать нарисовать то, что не сохранится.
  useEffect(() => {
    if (mode === 'template' && brush === 'TOURNAMENT') {
      setBrush('TRAINING');
    }
  }, [mode, brush]);

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

    // Человек кладётся только туда, где он осмыслен: тренер у занятия, клиент
    // у аренды. Перекрёстные поля не просто необязательны, а запрещены —
    // иначе в статистику тренера попадут чужие часы.
    const attachment = attachmentOf(brush);

    return {
      purpose: brush,
      coachId: attachment === 'coach' ? coachId : null,
      clientId: attachment === 'client' ? (client?.id ?? null) : null,
      trainingTypeId: brush === 'TRAINING' ? trainingTypeId : null,
      // Турнир ещё не заведён — в клетке пока только его тип. Сам турнир
      // создастся при сохранении, из даты расписания и времени первого окна.
      tournamentId: null,
      tournamentTypeId: brush === 'TOURNAMENT' ? tournamentTypeId : null,
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
        const rules = slots.map(({ lane: laneKey, tournamentTypeId: _type, ...slot }) => ({
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
        const closures = await resolveTournaments(
          slots.map(({ lane: _lane, ...slot }) => slot),
          date,
          timezone,
          onTournamentsChanged,
        );

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
                className={cn(inputClassName, 'w-auto py-1.5 text-[0.875rem]')}
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

        <SchedulePalette
          brush={brush}
          onBrush={setBrush}
          coaches={coaches}
          coachId={coachId}
          onCoach={setCoachId}
          client={client}
          onClient={setClient}
          colors={colors}
          trainingTypes={trainingTypes}
          trainingTypeId={trainingTypeId}
          onTrainingType={setTrainingTypeId}
          tournamentTypes={tournamentTypes}
          tournamentTypeId={tournamentTypeId}
          onTournamentType={setTournamentTypeId}
          // Турнир привязан к конкретной дате, поэтому в шаблоне недели его
          // кисти нет вовсе — не только запрещено сервером, но и не предложено.
          allowTournament={mode === 'day'}
        />

        {loading ? (
          <div className="h-64 animate-pulse rounded-control border border-border bg-surface-sunken" />
        ) : (
          <Grid
            tables={own}
            lane={lane}
            cells={cells}
            nameOf={nameOf}
            colors={colors}
            painting={painting}
            brushValue={brushValue}
            onPaint={paint}
          />
        )}

        {!loading && <Legend cells={cells} lane={lane} nameOf={nameOf} colors={colors} />}

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
/**
 * Таблица «время × столы» одной дорожки.
 *
 * Цвет клетки — это ЧЕЛОВЕК, а не назначение: тренеров и арендаторов в
 * расписании десятки, и различать их по подписи в клетке высотой в 28
 * пикселей тяжело, а назначений всего пять и они подписаны словом. Назначение
 * при этом не теряется — оно в полоске слева и в подписи окна.
 */
function Grid({
  tables,
  lane,
  cells,
  nameOf,
  colors,
  painting,
  brushValue,
  onPaint,
}: {
  tables: ClubTable[];
  lane: string;
  cells: Cells;
  nameOf: (id: string) => string;
  colors: Map<string, PersonColor>;
  painting: { current: CellValue | null | undefined };
  brushValue: () => CellValue | null;
  onPaint: (tableId: string, slot: number, value: CellValue | null) => void;
}) {
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
                const purposeLabel = value ? PURPOSE_LABEL.get(value.purpose) : 'свободно';
                const personId = value ? personOf(value) : null;
                const person = personId ? nameOf(personId) : null;
                const color = personId ? colors.get(personId) : undefined;

                // Подпись ставится только там, где окно начинается: иначе
                // четырёхчасовая тренировка повторила бы фамилию восемь раз
                // подряд и сетку стало бы невозможно читать.
                const above = cells.get(cellKey(lane, table.id, slot - 1));
                const startsHere =
                  value !== undefined &&
                  (above === undefined ||
                    above.purpose !== value.purpose ||
                    above.coachId !== value.coachId ||
                    above.clientId !== value.clientId);

                const needsCoach = value?.purpose === 'TRAINING' && !personId;

                return (
                  <td key={table.id} className="border-b border-l border-border p-0">
                    <button
                      type="button"
                      aria-pressed={value !== undefined}
                      aria-label={`${table.label}, ${slotLabel(slot)} — ${purposeLabel}${person ? `, ${person}` : ''}`}
                      title={person ? `${purposeLabel}: ${person}` : purposeLabel}
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
                          value.coachId === next.coachId &&
                          value.clientId === next.clientId;

                        painting.current = same ? null : next;
                        onPaint(table.id, slot, painting.current);
                      }}
                      onPointerEnter={() => {
                        if (painting.current !== undefined) {
                          onPaint(table.id, slot, painting.current);
                        }
                      }}
                      className={cn(
                        'relative flex h-7 w-full items-center overflow-hidden pr-1 pl-5 text-left text-[0.6875rem] leading-none whitespace-nowrap transition-colors',
                        // Цвет человека, если он закреплён; иначе — назначения.
                        // Оттенок назначения остаётся в полоске слева, поэтому
                        // одно другое не вытесняет.
                        color ? color.cell : value ? PURPOSE_CELL.get(value.purpose) : 'hover:bg-surface-sunken',
                        value ? 'hover:brightness-110' : '',
                      )}
                    >
                      {value && (
                        // Буква назначения, а не цветная полоска: цвет клетки
                        // занят человеком, и второй цвет рядом с ним местами
                        // сливается.
                        <span
                          className="absolute inset-y-0 left-0 flex w-3.5 items-center justify-center bg-black/25 text-[0.625rem] font-medium text-white/85"
                          aria-hidden="true"
                        >
                          {PURPOSE_MARK.get(value.purpose)}
                        </span>
                      )}

                      {startsHere && person && (
                        <span className="text-accent-text/90">{shortName(person)}</span>
                      )}
                      {startsHere && !person && value && !needsCoach && (
                        <span className="text-accent-text/70">{purposeLabel}</span>
                      )}
                      {startsHere && needsCoach && (
                        // Тренировка без тренера не сохранится: сервер её
                        // отклонит. Лучше сказать об этом сразу в клетке, чем
                        // сообщением после нажатия «Сохранить».
                        <span className="text-warning">нужен тренер</span>
                      )}
                    </button>
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

/** Кто занят в этой дорожке — с цветами, которыми они закрашены. */
function Legend({
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
              className={cn('h-3 w-3 rounded-sm', colors.get(person.id)?.dot)}
              aria-hidden="true"
            />
            {person.name}
          </span>
        ))}
    </div>
  );
}

/**
 * Заведение турниров под окна, где выбран только тип.
 *
 * Турнир создаётся не мазком кисти, а сохранением: иначе база наполнялась бы
 * турнирами, которые администратор тут же стёр. Один турнир на тип и дату —
 * два турнира одного типа в один день клуб не проводит, а если проведёт,
 * второй заводится сменой типа.
 *
 * Время начала берётся у самого раннего закрашенного окна: именно его
 * администратор и разметил как начало.
 */
async function resolveTournaments(
  closures: (ClosureSlot & { tournamentTypeId: string | null })[],
  date: string,
  timezone: string,
  onCreated: () => void,
): Promise<ClosureSlot[]> {
  const pending = closures.filter(
    (slot) => slot.purpose === 'TOURNAMENT' && !slot.tournamentId && slot.tournamentTypeId,
  );

  const created = new Map<string, string>();

  for (const typeId of new Set(pending.map((slot) => slot.tournamentTypeId!))) {
    const earliest = Math.min(
      ...pending.filter((slot) => slot.tournamentTypeId === typeId).map((slot) => slot.startMinute),
    );

    const startsAt = zonedToInstant(date, formatMinute(earliest), timezone);

    if (!startsAt) {
      throw new ApiError('Не удалось определить время начала турнира', 400);
    }

    const tournament = await api.createTournament({
      tournamentTypeId: typeId,
      startsAt: startsAt.toISOString(),
    });

    created.set(typeId, tournament.id);
  }

  if (created.size > 0) {
    onCreated();
  }

  return closures.map(({ tournamentTypeId, ...slot }) => ({
    ...slot,
    tournamentId:
      slot.tournamentId ?? (tournamentTypeId ? (created.get(tournamentTypeId) ?? null) : null),
  }));
}

/** Минуты от полуночи в «15:00» — для сборки момента начала турнира. */
function formatMinute(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
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
