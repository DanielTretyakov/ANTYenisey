'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ClosureSlot,
  ClubCoach,
  ClubTable,
  DayClosureDraft,
  DeskBooking,
  Tournament,
  TournamentType,
  TrainingType,
} from '@yenisey/types';
import { shortName } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { inputClassName } from '@/components/ui/Field';
import { formatDate, formatMinute, todayIn } from '@/lib/bookingGrid';
import {
  cellsToSlots,
  GRID_END_MINUTE,
  markTouched,
  minuteOfInstant,
  nowMinuteIn,
  shiftDate,
  slotMinute,
  slotRange,
  slotsToCells,
  splitByGrid,
  toDayClosureDraft,
  weekdayOf,
} from '@/lib/closureGrid';
import { cn } from '@/lib/cn';
import { formatKopecks } from '@/lib/money';
import { zonedToInstant } from '@/lib/timezones';
import { useClubApi } from '@/lib/useClubApi';
import { resolveEvents } from './dayEvents';
import { ScheduleCanvas } from './ScheduleCanvas';
import { seatsClient } from './SchedulePalette';
import type { BookedCell } from './ScheduleGrid';
import { messageOf, NoTables } from './TemplateBoard';
import { useScheduleGrid } from './useScheduleGrid';

/** Дорожка расписания даты — она одна, в отличие от семи дорожек шаблона. */
const DAY_LANE = 'day';

/**
 * Расписание конкретной даты.
 *
 * Правленый день ЗАМЕНЯЕТ шаблон целиком, поэтому в нём можно и добавить
 * занятие, и убрать то, что стоит в шаблоне. Неправленый показывается по
 * шаблону — пустая сетка на нём врала бы сильнее: администратор смотрел бы на
 * «свободно» там, где стоит детская группа.
 *
 * Три состояния, и каждое названо словами, а не подразумевается:
 * - день идёт по шаблону — сохранять нечего, «Сохранить» погашена;
 * - по шаблону, но уже есть правки — сохранение отвяжет день, и об этом
 *   сказано рядом с кнопкой;
 * - отвязан — живёт своим расписанием, его можно вернуть к шаблону.
 *
 * Раньше второго и третьего различия не было: на неправленом дне «Сохранить»
 * оставалась активной даже без правок, и одно случайное нажатие отвязывало
 * субботу навсегда, заодно заводя в базе занятия из шаблонных окон.
 */
export function DayBoard({
  hallId,
  timezone,
  tables,
  coaches,
  trainingTypes,
  tournamentTypes,
  tournaments,
  onTournamentsChanged,
}: {
  hallId: string;
  /** Пояс ЗАЛА, а не клуба: «сегодня» у зала в другом регионе своё. */
  timezone: string;
  tables: ClubTable[];
  coaches: ClubCoach[];
  trainingTypes: TrainingType[];
  tournamentTypes: TournamentType[];
  tournaments: Tournament[];
  /** Сохранение дня заводит и убирает турниры — список в каталоге устарел. */
  onTournamentsChanged: () => void;
}) {
  const club = useClubApi();
  const [date, setDate] = useState(() => todayIn(timezone));
  const today = todayIn(timezone);

  const grid = useScheduleGrid({
    hallId,
    lane: DAY_LANE,
    tables,
    coaches,
    trainingTypes,
    tournamentTypes,
    tournaments,
  });

  /** Ночные окна — сразу в виде, в каком их примет сервер: без `weekday` шаблона. */
  const [night, setNight] = useState<DayClosureDraft[]>([]);
  /** Брони этого дня: сетка их показывает, но кистью не трогает. */
  const [bookings, setBookings] = useState<DeskBooking[]>([]);
  /** Промежуток, который администратор протянул кистью аренды с клиентом. */
  const [seat, setSeat] = useState<Seat | null>(null);
  const [customised, setCustomised] = useState(false);
  const [customisedDates, setCustomisedDates] = useState<string[]>([]);
  const [asking, setAsking] = useState<'detach' | 'reset' | null>(null);

  const { accept, setError, setLoading, setPending } = grid;

  const show = useCallback(
    (closures: readonly ClosureSlot[]): void => {
      const split = splitByGrid(closures);

      setNight(split.night.map(toDayClosureDraft));
      accept(slotsToCells(split.inGrid, () => DAY_LANE));
    },
    [accept],
  );

  // Отвязанные даты грузятся раз на зал, а не при каждой смене даты: с лентой
  // дат это был бы лишний запрос на каждый клик. Дальше список правится на
  // месте — после сохранения, отвязки и возврата.
  useEffect(() => {
    club
      .customisedDates(hallId)
      .then(setCustomisedDates)
      .catch(() => setCustomisedDates([]));
  }, [club, hallId]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setAsking(null);

    try {
      const day = await club.daySchedule(hallId, date);

      // Неправленый день — по шаблону: администратор правит то, что видит, а
      // не пустую сетку, из которой непонятно, что сегодня происходит.
      const source = day.customised
        ? day.closures
        : (await club.template(hallId)).filter((rule) => rule.weekday === weekdayOf(date));

      show(source);
      setCustomised(day.customised);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, [club, hallId, date, show, setError, setLoading]);

  useEffect(() => {
    void load();
  }, [load]);

  // --- Брони ---------------------------------------------------------------

  /**
   * Брони дня — отдельным запросом, а не частью расписания.
   *
   * Расписание — это план клуба, а бронь — договорённость с человеком, и живут
   * они в разных таблицах. Сетке они нужны, чтобы не предлагать закрасить
   * занятое: сервер такую бронь всё равно не пустит, но узнать об этом лучше
   * до протяжки, а не после «Сохранить».
   */
  const loadBookings = useCallback(async (): Promise<void> => {
    const rows = await club.deskBookings({ hallId, from: date, to: shiftDate(date, 1) });

    // Отменённая и неявка стол не занимают: exclusion-констрейнт их не
    // считает, и сетка не должна считать тоже.
    setBookings(rows.filter((row) => row.status === 'BOOKED' || row.status === 'ATTENDED'));
  }, [club, hallId, date]);

  useEffect(() => {
    setBookings([]);
    setSeat(null);
    loadBookings().catch(() => setBookings([]));
  }, [loadBookings]);

  const booked = useMemo(
    () => bookedCells(bookings, timezone),
    [bookings, timezone],
  );

  const seating = seatsClient(grid.palette.brush) && grid.palette.client !== null;

  // --- Текущее время -----------------------------------------------------------

  const [nowMinute, setNowMinute] = useState(() => nowMinuteIn(timezone));

  useEffect(() => {
    const tick = (): void => setNowMinute(nowMinuteIn(timezone));
    // Полминуты, а не секунда: при 36 пикселях на полчаса линия проходит
    // пиксель за пятьдесят секунд, и чаще перерисовывать незачем.
    const id = setInterval(tick, 30_000);

    // Фоновая вкладка таймеры душит: без пересчёта на возврате администратор
    // увидит линию там, где она была час назад, — и поверит ей.
    document.addEventListener('visibilitychange', tick);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [timezone]);

  // --- Действия ----------------------------------------------------------------

  async function run(action: () => Promise<void>): Promise<void> {
    setError(null);
    setPending(true);

    try {
      await action();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
      setAsking(null);
    }
  }

  const markCustomised = (): void => {
    setCustomised(true);
    setCustomisedDates((previous) =>
      previous.includes(date) ? previous : [...previous, date].sort(),
    );
  };

  const save = (): Promise<void> =>
    run(async () => {
      const slots = cellsToSlots(grid.cells, [DAY_LANE], grid.tableIds);

      const closures = await resolveEvents(
        club,
        markTouched(slots, grid.cells, grid.saved, () => DAY_LANE),
        { date, timezone, capacity: grid.palette.capacity },
        onTournamentsChanged,
      );

      const stored = await club.replaceDay(hallId, date, [...night, ...closures]);

      show(stored.closures);
      markCustomised();
      // Стёртое из дня занятие сервер убирает вместе с правкой — каталог мог
      // измениться и в эту сторону, а не только прибавиться.
      onTournamentsChanged();
    });

  const detach = (): Promise<void> =>
    run(async () => {
      const stored = await club.detachDay(hallId, date);

      show(stored.closures);
      markCustomised();
      // Турнир из шаблона при отвязке заводится — без него окна турнира в дне
      // не бывает, — и список турниров в каталоге устарел.
      onTournamentsChanged();
    });

  const reset = (): Promise<void> =>
    run(async () => {
      await club.resetDay(hallId, date);
      setCustomisedDates((previous) => previous.filter((item) => item !== date));
      onTournamentsChanged();
      await load();
    });

  /**
   * Посадить человека на протянутый промежуток.
   *
   * Бронь заводится сразу, а не при «Сохранить»: она не часть расписания —
   * это чужие деньги и запись в кабинете человека, и откладывать её до общего
   * сохранения дня значило бы смешать план клуба с договорённостью с клиентом.
   * Цену считает сервер, здесь она только показывается.
   */
  const confirmSeat = (): Promise<void> =>
    run(async () => {
      if (!seat || !grid.palette.client) return;

      const startsAt = zonedToInstant(date, formatMinute(seat.startMinute), timezone);

      if (!startsAt) {
        throw new Error('Не удалось определить время начала');
      }

      await club.createDeskBooking({
        clientId: grid.palette.client.id,
        tableId: seat.tableId,
        startsAt: startsAt.toISOString(),
        durationMinutes: seat.endMinute - seat.startMinute,
        withRobot: grid.palette.brush === 'ROBOT',
      });

      setSeat(null);
      await loadBookings();
    });

  if (grid.own.length === 0) {
    return <NoTables />;
  }

  return (
    <>
      <DayStrip
        date={date}
        today={today}
        customisedDates={customisedDates}
        onDate={setDate}
        disabled={grid.pending}
      />

      {grid.error && <Alert>{grid.error}</Alert>}

      <ScheduleCanvas
        grid={grid}
        lane={DAY_LANE}
        askCapacity
        allowClient
        booked={booked}
        onRange={
          seating
            ? (tableId, from, to) =>
                setSeat({
                  tableId,
                  startMinute: slotMinute(from),
                  endMinute: slotMinute(to),
                })
            : undefined
        }
        nightCount={night.length}
        nowMinute={date === today ? nowMinute : null}
      />

      {seat && grid.palette.client && (
        <SeatQuestion
          seat={seat}
          person={grid.palette.client.fullName}
          tableLabel={grid.own.find((table) => table.id === seat.tableId)?.label ?? ''}
          hallId={hallId}
          withRobot={grid.palette.brush === 'ROBOT'}
          pending={grid.pending}
          onConfirm={() => void confirmSeat()}
          onCancel={() => setSeat(null)}
        />
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <DayState
          customised={customised}
          dirty={grid.dirty}
          asking={asking}
          pending={grid.pending}
          onAsk={setAsking}
          onDetach={() => void detach()}
          onReset={() => void reset()}
        />

        <span className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={grid.clearLane}>
            Очистить день
          </Button>
          <Button
            type="button"
            pending={grid.pending}
            // Гаснет, пока нечего сохранять, — и в дне тоже. Раньше на
            // неправленом дне она оставалась живой, потому что сохранение было
            // единственным способом отвязать день. Отвязка теперь отдельное
            // действие и называется своим именем.
            disabled={!grid.dirty}
            onClick={() => void save()}
          >
            Сохранить день
          </Button>
        </span>
      </div>
    </>
  );
}

/**
 * Состояние дня словами — и действие, которое из него ведёт.
 *
 * Отвязка и возврат — в два шага, как отмена брони на экране смены: оба
 * необратимы по смыслу (обратно — только другим действием), а рядом с ними
 * кнопка, по которой кликают постоянно.
 */
function DayState({
  customised,
  dirty,
  asking,
  pending,
  onAsk,
  onDetach,
  onReset,
}: {
  customised: boolean;
  dirty: boolean;
  asking: 'detach' | 'reset' | null;
  pending: boolean;
  onAsk: (question: 'detach' | 'reset' | null) => void;
  onDetach: () => void;
  onReset: () => void;
}) {
  if (asking === 'detach') {
    return (
      <Question
        text="Расписание дня станет копией шаблона и дальше будет жить само по себе: правки шаблона на него перестанут действовать. Занятия для записи при этом не заводятся — их вы поставите кистью; турниры из шаблона заведутся на эту дату."
        confirm="Отвязать"
        pending={pending}
        onConfirm={onDetach}
        onCancel={() => onAsk(null)}
      />
    );
  }

  if (asking === 'reset') {
    return (
      <Question
        text="Правки этого дня пропадут, и он снова пойдёт по шаблону. Занятия и турниры, заведённые правкой и никуда больше не поставленные, уйдут вместе с днём — кроме тех, на которые уже записались."
        confirm="Вернуть к шаблону"
        pending={pending}
        onConfirm={onReset}
        onCancel={() => onAsk(null)}
      />
    );
  }

  if (customised) {
    return (
      <span className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
        <span className="rounded-full border border-border-accent bg-surface-accent-soft px-2.5 py-1 text-text-accent">
          День отвязан от шаблона
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => onAsk('reset')}>
          Вернуть к шаблону
        </Button>
      </span>
    );
  }

  if (dirty) {
    return (
      <span className="rounded-full border border-warning-border bg-warning-soft px-2.5 py-1 text-[0.8125rem] text-warning">
        После сохранения день отвяжется от шаблона
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-text-muted">
      <span className="rounded-full border border-border px-2.5 py-1">День идёт по шаблону</span>
      <Button type="button" variant="secondary" size="sm" onClick={() => onAsk('detach')}>
        Отвязать от шаблона
      </Button>
    </span>
  );
}

function Question({
  text,
  confirm,
  pending,
  onConfirm,
  onCancel,
}: {
  text: string;
  confirm: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <span className="flex max-w-3xl flex-wrap items-center gap-2 text-[0.8125rem]">
      <span className="basis-full text-text-muted sm:basis-auto sm:flex-1">{text}</span>
      <Button type="button" size="sm" pending={pending} onClick={onConfirm}>
        {confirm}
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
        Не надо
      </Button>
    </span>
  );
}

/**
 * Лента дат: вчера, сегодня и две недели вперёд одним рядом.
 *
 * Расписание правят на ближайшие дни, и прыгать к ним через календарь в поле
 * даты — три нажатия на каждый день. Дальние даты по-прежнему доступны через
 * поле справа.
 *
 * Точка под датой — день отвязан от шаблона: его правка шаблона не касается, и
 * администратор должен видеть это до того, как решит, что шаблон всё поправил.
 */
function DayStrip({
  date,
  today,
  customisedDates,
  onDate,
  disabled,
}: {
  date: string;
  today: string;
  customisedDates: string[];
  onDate: (date: string) => void;
  disabled: boolean;
}) {
  // Лента держится вокруг сегодняшнего дня, пока выбранная дата в неё
  // помещается, и уезжает вслед за выбором, когда нет: иначе, листая стрелкой
  // вперёд, администратор ушёл бы за край ленты и перестал видеть, где он.
  const start =
    date >= shiftDate(today, -1) && date <= shiftDate(today, 14) ? shiftDate(today, -1) : shiftDate(date, -1);
  const days = Array.from({ length: 16 }, (_, index) => shiftDate(start, index));
  const customisedSet = new Set(customisedDates);

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => onDate(shiftDate(date, -1))}
          aria-label="Предыдущий день"
        >
          ←
        </Button>

        <p className="min-w-[14rem] text-[1rem] font-medium">
          {formatDate(date)}
          {date === today && <span className="ml-2 text-[0.8125rem] text-text-accent">сегодня</span>}
        </p>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => onDate(shiftDate(date, 1))}
          aria-label="Следующий день"
        >
          →
        </Button>

        {date !== today && (
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onDate(today)}>
            Сегодня
          </Button>
        )}

        <label className="ml-auto">
          <span className="sr-only">Другая дата</span>
          <input
            type="date"
            value={date}
            disabled={disabled}
            onChange={(event) => event.target.value && onDate(event.target.value)}
            className={cn(inputClassName, 'w-auto py-1.5 text-[0.875rem]')}
          />
        </label>
      </div>

      <div className="mt-3 flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Дата">
        {days.map((day) => {
          const active = day === date;
          const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'UTC' }).format(
            new Date(`${day}T00:00:00Z`),
          );

          return (
            <button
              key={day}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={disabled}
              onClick={() => onDate(day)}
              title={customisedSet.has(day) ? 'День отвязан от шаблона' : undefined}
              className={cn(
                'relative flex w-12 shrink-0 flex-col items-center rounded-control border py-1.5 transition-colors',
                active
                  ? 'border-border-accent bg-surface-accent-soft text-text-accent'
                  : 'border-border text-text-muted hover:bg-surface-sunken',
                // Выходные различаются приглушённо: в клубе это самые загруженные
                // дни, и искать их в ленте приходится чаще прочих.
                (weekdayOf(day) === 6 || weekdayOf(day) === 7) && !active && 'bg-surface-sunken/60',
              )}
            >
              <span className="text-[0.6875rem] uppercase">{weekday}</span>
              <span
                className={cn(
                  'font-display text-[1rem] leading-tight tabular-nums',
                  day === today && 'underline decoration-accent decoration-2 underline-offset-4',
                )}
              >
                {Number(day.slice(8, 10))}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'mt-0.5 h-1 w-1 rounded-full',
                  customisedSet.has(day) ? 'bg-accent' : 'bg-transparent',
                )}
              />
            </button>
          );
        })}
      </div>

      <p className="mt-1 text-[0.75rem] text-text-subtle">
        Точкой отмечены дни, отвязанные от шаблона.
      </p>
    </div>
  );
}

/** Промежуток, протянутый кистью аренды: из него получится бронь. */
interface Seat {
  tableId: string;
  startMinute: number;
  endMinute: number;
}

/**
 * Брони дня → занятые клетки сетки.
 *
 * Минуты считаются по поясу ЗАЛА, а не браузера: бронь в абаканском зале не
 * должна съезжать на час оттого, что администратор смотрит из Красноярска.
 */
function bookedCells(bookings: readonly DeskBooking[], timezone: string): Map<string, BookedCell> {
  const cells = new Map<string, BookedCell>();

  for (const booking of bookings) {
    const startMinute = minuteOfInstant(booking.startsAt, timezone);
    // Конец ровно в полночь местные сутки отдают как 1440, а не как 0: иначе
    // промежуток вывернулся бы и бронь пропала из сетки.
    const endMinute = minuteOfInstant(booking.endsAt, timezone) || GRID_END_MINUTE;
    const { from, to } = slotRange(startMinute, endMinute);

    for (let slot = from; slot < to; slot += 1) {
      cells.set(`${booking.tableId}|${slot}`, {
        person: booking.client.fullName,
        startsHere: slot === from,
      });
    }
  }

  return cells;
}

/**
 * «Посадить человека?» — с ценой, которую вернул сервер.
 *
 * Два шага, как у отмены брони на экране смены: за бронью стоят чужие деньги,
 * и протяжка мышью слишком дёшева, чтобы сразу их списывать. Цена приходит с
 * сервера — второй расчёт в форме разошёлся бы с ним молча.
 */
function SeatQuestion({
  seat,
  person,
  tableLabel,
  hallId,
  withRobot,
  pending,
  onConfirm,
  onCancel,
}: {
  seat: Seat;
  person: string;
  tableLabel: string;
  hallId: string;
  withRobot: boolean;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const club = useClubApi();
  const [price, setPrice] = useState<number | null>(null);
  const minutes = seat.endMinute - seat.startMinute;

  useEffect(() => {
    let cancelled = false;

    setPrice(null);
    club
      .bookingQuote(hallId, minutes, withRobot)
      .then((quote) => {
        if (!cancelled) setPrice(quote.price);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [club, hallId, minutes, withRobot]);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-control border border-border-accent bg-surface-accent-soft px-4 py-3 text-[0.875rem]">
      <span>
        Посадить <b>{shortName(person)}</b> · {tableLabel} ·{' '}
        <span className="tabular-nums">
          {formatMinute(seat.startMinute)}–{formatMinute(seat.endMinute)}
        </span>
        {withRobot ? ' · с роботом' : ''}
      </span>

      <span className="font-display text-[1.125rem] tabular-nums">
        {price === null ? '…' : formatKopecks(price)}
      </span>

      <span className="ml-auto flex items-center gap-2">
        <Button size="sm" pending={pending} onClick={onConfirm}>
          Посадить
        </Button>
        <Button size="sm" variant="secondary" disabled={pending} onClick={onCancel}>
          Не надо
        </Button>
      </span>

      <p className="basis-full text-[0.8125rem] text-text-subtle">
        Заведётся бронь: человек увидит её в «Моих записях» и сможет отменить сам. Расписание
        этим не меняется — «Сохранить день» для брони не нужно.
      </p>
    </div>
  );
}
