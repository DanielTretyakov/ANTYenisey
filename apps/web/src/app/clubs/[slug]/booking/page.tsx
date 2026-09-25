'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BOOKING_HORIZON_DAYS,
  type BookingQuote,
  type ClientBooking,
  type Hall,
  type PublicBlockKind,
  type PublicBoardBlock,
  type PublicBoardTable,
  type PublicDayBoard,
} from '@yenisey/types';
import { EventDialog } from '@/components/events/EventDialog';
import { WhenSpan } from '@/components/club/When';
import { PersonSwitch } from '@/components/family/PersonSwitch';
import { AppShell } from '@/components/layout/AppShell';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { ApiError } from '@/lib/api';
import { loginHref } from '@/lib/next';
import { tintFill, tintMark } from '@/lib/personColor';
import { roleInClub } from '@/lib/membership';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import {
  bookableDates,
  bookableMinutes,
  cellState,
  durationsFrom,
  formatDate,
  formatDuration,
  formatMinute,
  todayIn,
  type CellState,
} from '@/lib/bookingGrid';
import { cn } from '@/lib/cn';
import { formatKopecks } from '@/lib/money';
import { usePersonSwitch } from '@/lib/usePersonSwitch';
import { useSession } from '@/lib/useSession';

/** Что клиент выбрал в сетке: стол и начало отрезка. */
interface Pick {
  tableId: string;
  startMinute: number;
}

/**
 * Бронь стола клиентом — и спарринг тренером.
 *
 * Сетка открыта и без входа (решение владельца от 24.09.2026): занятое время
 * подписано — аренда, занятие с тренером, турнир, — и занятие или турнир
 * открывают окно мероприятия, как на стартовой. Бронировать — после входа, с
 * возвратом сюда же.
 *
 * Порядок экрана повторяет порядок решения: сначала зал, потом день, потом
 * время. Обратный — «выберите время, а потом посмотрим, в каком зале» — не
 * работает: цены и шаг брони у залов разные, и без зала сетку не построить.
 *
 * Цена показывается до подтверждения. Узнать сумму после того, как бронь уже
 * заведена, — не тот порядок, даже пока за ней не стоит холд.
 *
 * Тренер бронирует эту же страницу и этой же сеткой — так сказано в ТЗ
 * («тем же механизмом бронирования, что и у клиента»). Отличается ровно три
 * вещи: маршрут записи, отсутствие переключателя «действую за» (за ребёнка
 * спарринг не берут) и то, что свои спарринги тренер видит здесь же — в «Мои
 * записи» они не попадают, потому что это записи клиента, а не сотрудника.
 */
export default function BookingPage() {
  const router = useRouter();
  const session = useSession();
  const family = usePersonSwitch();

  const club = useClubApi();
  const slug = useClubSlug();

  const role = session.status === 'ready' ? (roleInClub(session.user, slug) ?? 'CLIENT') : 'CLIENT';
  const sparring = role === 'COACH';
  const [sparrings, setSparrings] = useState<ClientBooking[] | null>(null);

  const [halls, setHalls] = useState<Hall[] | null>(null);
  const [hallId, setHallId] = useState('');
  const [date, setDate] = useState('');
  const [day, setDay] = useState<PublicDayBoard | null>(null);
  const [event, setEvent] = useState<NonNullable<PublicBoardBlock['event']> | null>(null);

  const [pick, setPick] = useState<Pick | null>(null);
  const [duration, setDuration] = useState(0);
  const [withRobot, setWithRobot] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const anonymous = session.status === 'anonymous';

  useEffect(() => {
    club
      .bookingHalls()
      .then((loaded) => {
        setHalls(loaded);
        setHallId((current) => current || (loaded[0]?.id ?? ''));
      })
      .catch((cause: unknown) => setError(messageOf(cause)));
  }, [club]);

  /**
   * Часовой пояс ВЫБРАННОГО ЗАЛА.
   *
   * Раньше он приходил из карточки клуба одним запросом на всю страницу.
   * Теперь пояс — свойство зала: залы одной организации бывают в разных
   * регионах, и «сегодня» у зала в Абакане своё. Пока залы не загружены,
   * берётся пояс браузера — сетка всё равно пустая.
   */
  const timezone =
    halls?.find((hall) => hall.id === hallId)?.timezone ??
    (halls === null ? null : Intl.DateTimeFormat().resolvedOptions().timeZone);

  const dates = useMemo(
    () => (timezone ? bookableDates(todayIn(timezone), BOOKING_HORIZON_DAYS) : []),
    [timezone],
  );

  useEffect(() => {
    setDate((current) => (current && dates.includes(current) ? current : (dates[0] ?? '')));
  }, [dates]);

  const loadDay = useCallback(() => {
    if (!hallId || !date) {
      return;
    }

    club
      .bookingBoard(hallId, date)
      .then((loaded) => {
        setDay(loaded);
        setError(null);
      })
      .catch((cause: unknown) => {
        setDay(null);
        setError(messageOf(cause));
      });
  }, [hallId, date, club]);

  useEffect(() => {
    // Выбор сбрасывается вместе с сеткой: отрезок, выбранный во вторник, во
    // вторую субботу означал бы совсем другое время.
    setPick(null);
    setDuration(0);
    loadDay();
  }, [loadDay]);

  const hall = halls?.find((item) => item.id === hallId) ?? null;
  const table = day?.tables.find((item) => item.tableId === pick?.tableId) ?? null;

  const durations = useMemo(
    () => (day && table && pick ? durationsFrom(day, table, pick.startMinute) : []),
    [day, table, pick],
  );

  // Длительность, выбранная на прежней клетке, на новой может не помещаться —
  // тогда берётся самая короткая доступная.
  const chosenDuration = durations.includes(duration) ? duration : (durations[0] ?? 0);

  const [quote, setQuote] = useState<BookingQuote | null>(null);

  /**
   * Цену считает сервер, а не форма.
   *
   * Второй расчёт на клиенте показывал бы сумму без запроса, но это деньги, и
   * двух мест, где они считаются, быть не должно: разойдясь однажды, они
   * разойдутся молча — форма покажет одно, а в бронь уйдёт другое.
   */
  useEffect(() => {
    if (!hallId || chosenDuration === 0) {
      setQuote(null);
      return;
    }

    let cancelled = false;

    club
      .bookingQuote(hallId, chosenDuration, withRobot && (hall?.hasRobotOption ?? false))
      .then((loaded) => {
        if (!cancelled) setQuote(loaded);
      })
      .catch(() => {
        if (!cancelled) setQuote(null);
      });

    return () => {
      cancelled = true;
    };
  }, [hallId, chosenDuration, withRobot, hall?.hasRobotOption, club]);

  const loadSparrings = useCallback(() => {
    if (!sparring) {
      return;
    }

    club
      .mySparrings()
      .then(setSparrings)
      .catch((cause: unknown) => setError(messageOf(cause)));
  }, [club, sparring]);

  useEffect(() => {
    if (session.status === 'ready') loadSparrings();
  }, [session.status, loadSparrings]);

  async function handleCancelSparring(id: string): Promise<void> {
    setError(null);

    try {
      await club.cancelSparring(id);
      loadSparrings();
      loadDay();
    } catch (cause: unknown) {
      setError(messageOf(cause));
    }
  }

  async function handleBook(): Promise<void> {
    if (!day || !pick || !timezone || chosenDuration === 0) {
      return;
    }

    setPending(true);
    setError(null);

    const payload = {
      tableId: pick.tableId,
      startsAt: instantAt(day.date, pick.startMinute, timezone),
      durationMinutes: chosenDuration,
      withRobot: withRobot && (hall?.hasRobotOption ?? false),
    };

    try {
      if (sparring) {
        await club.createSparring(payload);
        // Тренер остаётся здесь: его спарринги живут на этой же странице, а в
        // «Мои записи» не попадают — там записи клиента.
        setPick(null);
        loadDay();
        loadSparrings();
        return;
      }

      await club.createBooking(payload, family.forPerson);

      // Записи уехали из кабинета в «Мои записи» — там же и свежая бронь; за
      // ребёнка — его записи.
      router.push(family.forPerson ? `/my-bookings?for=${family.forPerson}` : '/my-bookings');
    } catch (cause: unknown) {
      setError(messageOf(cause));
      // Сетку перечитываем: «стол только что заняли» означает, что чужая бронь
      // уже есть, и показывать это время свободным дальше нельзя.
      loadDay();
      setPick(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <AppShell>
      <h1 className="mb-7 text-[1.75rem]">
        {sparring ? 'Стол под спарринг' : 'Забронировать стол'}
      </h1>

      {!sparring && (
        <PersonSwitch
          people={family.children}
          selected={family.selected}
          onChoose={family.choose}
          className="mb-6"
        />
      )}

      {!sparring && family.selfIsChild && (
        <Alert tone="info">
          До 14 лет стол бронирует родитель — или администратор клуба у стойки. Свободное время посмотреть можно.
        </Alert>
      )}

      {error && <Alert>{error}</Alert>}

      <Card className="mb-6">
        <CardHeader
          title="Зал и день"
          description={`Бронировать можно на ближайшие ${BOOKING_HORIZON_DAYS} дней.`}
        />
        <CardBody className="grid gap-x-6 sm:grid-cols-2">
          <Select
            label="Зал"
            value={hallId}
            onChange={(event) => setHallId(event.target.value)}
            options={(halls ?? []).map((item) => ({ value: item.id, label: item.name }))}
          />

          <Select
            label="День"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            options={dates.map((value) => ({ value, label: formatDate(value) }))}
          />
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader
          title="Время"
          description="Свободное — светлым, занятое подписано: аренда, занятие, турнир. На занятие и турнир можно нажать — откроется запись. Прошедшее время не показывается."
        />
        <CardBody>
          {day && day.tables.length > 0 ? (
            <>
              <Legend />
              <Grid day={day} pick={pick} onPick={setPick} onEvent={setEvent} />
            </>
          ) : (
            <p className="text-[0.875rem] text-text-muted">
              {day ? 'В этом зале пока нет столов.' : 'Загружаем расписание…'}
            </p>
          )}
        </CardBody>
      </Card>

      {pick && table && day && (
        <Card>
          <CardHeader
            title="Подтверждение"
            description={`${table.label}, ${formatDate(day.date)}, начало в ${formatMinute(pick.startMinute)}.`}
          />
          <CardBody>
            <div className="grid gap-x-6 sm:grid-cols-2">
              <Select
                label="Длительность"
                value={String(chosenDuration)}
                onChange={(event) => setDuration(Number(event.target.value))}
                options={durations.map((value) => ({
                  value: String(value),
                  label: formatDuration(value),
                }))}
              />

              {hall?.hasRobotOption && (
                <Toggle
                  label="Со столовым роботом"
                  hint="Отдельная услуга со своей ценой, а не наценка поверх аренды."
                  checked={withRobot}
                  onChange={(event) => setWithRobot(event.target.checked)}
                />
              )}
            </div>

            <p className="mb-5 text-[0.9375rem]">
              Стоимость:{' '}
              <span className="text-lg text-text">
                {quote === null ? '—' : formatKopecks(quote.price)}
              </span>
              {quote !== null && quote.billedMinutes !== quote.durationMinutes && (
                <span className="ml-2 text-[0.8125rem] text-text-muted">
                  оплачивается {formatDuration(quote.billedMinutes)}: начатые полчаса считаются
                  полными
                </span>
              )}
            </p>

            {anonymous ? (
              // Выбор не теряется напрасно: после входа человек вернётся на эту
              // же сетку и выберет снова — цена та же, её считает сервер.
              <Link href={loginHref()}>
                <Button>Войти и забронировать</Button>
              </Link>
            ) : (
              <Button
                onClick={() => void handleBook()}
                pending={pending}
                disabled={chosenDuration === 0 || (!sparring && family.selfIsChild)}
              >
                {sparring ? 'Взять стол' : 'Забронировать'}
              </Button>
            )}
          </CardBody>
        </Card>
      )}

      {sparring && (
        <Card className="mt-6">
          <CardHeader
            title="Мои спарринги"
            description="Стол занят на вас. С кем именно вы играете, платформа не спрашивает."
          />
          <CardBody>
            {sparrings === null && <p className="text-[0.875rem] text-text-muted">Загружаем…</p>}
            {sparrings?.length === 0 && (
              <p className="text-[0.875rem] text-text-muted">Взятых столов пока нет.</p>
            )}
            {sparrings && sparrings.length > 0 && (
              <ul className="divide-y divide-border">
                {sparrings.map((booking) => (
                  <li key={booking.id} className="flex flex-wrap items-start gap-x-6 gap-y-2 py-3 first:pt-0 last:pb-0">
                    <WhenSpan startsAt={booking.startsAt} endsAt={booking.endsAt} />
                    <span className="min-w-0 flex-1 text-[0.9375rem]">
                      {booking.tableLabel}
                      <span className="text-text-muted"> · {booking.hallName}</span>
                      <span className="mt-0.5 block text-[0.8125rem] text-text-muted">
                        {formatKopecks(booking.price)}
                        {booking.status === 'CANCELLED' && ' · отменён'}
                        {booking.status === 'NO_SHOW' && ' · неявка'}
                        {booking.status === 'ATTENDED' && ' · состоялся'}
                      </span>
                    </span>
                    {booking.status === 'BOOKED' && booking.cancelChargePercentNow !== null && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleCancelSparring(booking.id)}
                      >
                        Отменить
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {event && (
        <EventDialog
          slug={slug}
          kind={event.kind}
          id={event.id}
          forPerson={family.forPerson}
          selfIsChild={family.selfIsChild}
          onClose={() => setEvent(null)}
          onChanged={loadDay}
        />
      )}
    </AppShell>
  );
}

/** Цвет занятого — по виду, те же краски, что в расписании у администратора. */
const KIND_PAINT: Record<PublicBlockKind, string> = {
  RENT: 'var(--hue-blue)',
  SPARRING: 'var(--hue-violet)',
  TRAINING: 'var(--brand-600)',
  TOURNAMENT: 'var(--hue-rose)',
  CLOSED: 'var(--ink-500)',
};

const KIND_LABEL: Record<PublicBlockKind, string> = {
  RENT: 'Аренда',
  SPARRING: 'Спарринг',
  TRAINING: 'Занятие',
  TOURNAMENT: 'Турнир',
  CLOSED: 'Стол занят',
};

function Legend() {
  return (
    <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[0.8125rem] text-text-muted">
      <li className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm bg-surface-sunken ring-1 ring-border" aria-hidden="true" />
        Свободно
      </li>
      {(Object.keys(KIND_LABEL) as PublicBlockKind[]).map((kind) => (
        <li key={kind} className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm" style={{ background: tintMark(KIND_PAINT[kind]) }} aria-hidden="true" />
          {KIND_LABEL[kind]}
        </li>
      ))}
    </ul>
  );
}

/** Блок, который накрывает клетку. */
function blockAt(table: PublicBoardTable, minute: number): PublicBoardBlock | null {
  return table.blocks.find((block) => block.startMinute <= minute && minute < block.endMinute) ?? null;
}

/**
 * Сетка «время × столы».
 *
 * Столбцами идут столы, строками — время: столов в зале единицы, а строк
 * времени десятки, и вертикальная прокрутка привычнее горизонтальной.
 */
function Grid({
  day,
  pick,
  onPick,
  onEvent,
}: {
  day: PublicDayBoard;
  pick: Pick | null;
  onPick: (pick: Pick | null) => void;
  onEvent: (event: NonNullable<PublicBoardBlock['event']>) => void;
}) {
  // Прошедшие клетки не рисуются вовсе: вечером они занимали три четверти
  // сетки, и человек скроллил мимо серого к своему времени.
  const rows = bookableMinutes(day);

  if (rows.length === 0) {
    return (
      <p className="text-[0.9375rem] text-text-muted">
        На сегодня время в этом зале уже кончилось — выберите другой день.
      </p>
    );
  }

  return (
    // Своя область прокрутки с прилипающей шапкой — как в расписании у
    // администратора: столов бывает дюжина, строк времени четыре десятка, и без
    // шапки столбцы на длинной сетке теряют имена.
    <div className="max-h-[calc(100dvh-16rem)] touch-pan-y overflow-auto">
      <table className="w-full table-fixed border-separate border-spacing-0 text-[0.8125rem]">
        <thead>
          <tr>
            <th className="sticky top-0 z-20 w-16 bg-surface-raised py-2 text-left font-medium text-text-subtle">
              Время
            </th>
            {day.tables.map((table) => (
              <th
                key={table.tableId}
                className="sticky top-0 z-20 bg-surface-raised px-1 py-2 font-medium text-text-muted"
              >
                {table.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((startMinute) => (
            <tr key={startMinute}>
              <td className="py-0.5 pr-2 align-middle text-text-subtle tabular-nums">
                {/* Подписан каждый час, а не каждая клетка: при шаге в десять
                    минут подписи слились бы в сплошной столбец цифр. */}
                {startMinute % 60 === 0 ? formatMinute(startMinute) : ''}
              </td>

              {day.tables.map((table) => (
                <Cell
                  key={table.tableId}
                  day={day}
                  table={table}
                  startMinute={startMinute}
                  // Подпись блока — в первой видимой его клетке: блок, начавшийся
                  // до «сейчас», подписывается на первой непрошедшей строке.
                  firstRow={rows[0] === startMinute}
                  picked={pick?.tableId === table.tableId && pick.startMinute === startMinute}
                  onPick={onPick}
                  onEvent={onEvent}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  day,
  table,
  startMinute,
  firstRow,
  picked,
  onPick,
  onEvent,
}: {
  day: PublicDayBoard;
  table: PublicBoardTable;
  startMinute: number;
  /** Первая показанная строка сетки: блок, начавшийся раньше, подписывается здесь. */
  firstRow: boolean;
  picked: boolean;
  onPick: (pick: Pick | null) => void;
  onEvent: (event: NonNullable<PublicBoardBlock['event']>) => void;
}) {
  const state = cellState(day, table, startMinute);
  const available = state === 'free';
  const block = state === 'busy' ? blockAt(table, startMinute) : null;

  if (block) {
    const labelled = firstRow || block.startMinute >= startMinute;
    const reason = block.subtitle ? `${block.title}, ${block.subtitle}` : block.title;
    const body = labelled ? (
      <span className="block truncate px-1 text-left text-[0.6875rem] leading-6 text-text">{block.title}</span>
    ) : null;
    const style = { background: tintFill(KIND_PAINT[block.kind]) };
    const target = block.event;

    return (
      <td className="px-0.5 py-0.5">
        {target ? (
          <button
            type="button"
            title={`${reason} — открыть`}
            aria-label={`${table.label}, ${formatMinute(startMinute)}: ${reason}. Открыть мероприятие`}
            onClick={() => onEvent(target)}
            className="h-6 w-full rounded-[3px] hover:brightness-95"
            style={style}
          >
            {body}
          </button>
        ) : (
          <span
            role="img"
            title={reason}
            aria-label={`${table.label}, ${formatMinute(startMinute)}: ${reason}`}
            className="block h-6 w-full cursor-not-allowed rounded-[3px]"
            style={style}
          >
            {body}
          </span>
        )}
      </td>
    );
  }

  return (
    <td className="px-0.5 py-0.5">
      <button
        type="button"
        disabled={!available}
        aria-pressed={picked}
        // «Занято» и «прошло» — разные ответы, и диктор должен называть их
        // по-разному: утренняя клетка сегодняшнего дня свободна, просто утро
        // кончилось.
        aria-label={`${table.label}, ${formatMinute(startMinute)}${LABELS[state]}`}
        onClick={() => onPick(picked ? null : { tableId: table.tableId, startMinute })}
        className={cn(
          'h-6 w-full rounded-[3px] transition-colors',
          picked && 'bg-accent',
          state === 'free' && !picked && 'bg-surface-sunken hover:bg-surface-accent-soft',
          // Занятое — плотнее прошедшего: за ним стоит чужая бронь, и его
          // стоит замечать, выбирая соседнее время.
          state === 'busy' && 'cursor-not-allowed bg-border/60',
          state === 'past' && 'cursor-not-allowed bg-surface-sunken/40',
        )}
      />
    </td>
  );
}

const LABELS: Record<CellState, string> = {
  free: '',
  busy: ', занято',
  past: ', время прошло',
};

/**
 * Местное время зала → мгновение в ISO-8601.
 *
 * Считается подбором смещения: перевести мгновение в зону браузер умеет, а
 * собрать мгновение из местных даты и часа — нет. Та же арифметика, что в
 * `instantAt` на сервере, и сервер всё равно проверяет результат.
 */
function instantAt(date: string, minute: number, timezone: string): string {
  const target = Date.parse(`${date}T00:00:00Z`) + minute * 60_000;
  let instant = new Date(target);

  for (let pass = 0; pass < 2; pass += 1) {
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);

    const value = (type: Intl.DateTimeFormatPartTypes): string =>
      local.find((part) => part.type === type)?.value ?? '';

    const actual =
      Date.parse(`${value('year')}-${value('month')}-${value('day')}T00:00:00Z`) +
      (Number(value('hour')) * 60 + Number(value('minute'))) * 60_000;

    if (actual === target) {
      break;
    }

    instant = new Date(instant.getTime() - (actual - target));
  }

  return instant.toISOString();
}

function messageOf(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером';
}
