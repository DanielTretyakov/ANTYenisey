'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  BOOKING_HORIZON_DAYS,
  type BookingQuote,
  type ClientBooking,
  type Hall,
  type PublicBlockKind,
  type PublicBoardBlock,
  type PublicBoardTable,
  type PublicDayBoard,
  type SparringStudent,
  type SparringType,
} from '@yenisey/types';
import { SparringStudentPicker } from './SparringStudent';
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
import { rolesInClub } from '@/lib/membership';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import {
  bookableDates,
  blockSpans,
  bookableMinutes,
  cellState,
  durationsFrom,
  formatDate,
  formatDuration,
  formatMinute,
  pickAfterClick,
  pickPart,
  todayIn,
  type BlockSpan,
  type CellState,
  type GridPick,
} from '@/lib/bookingGrid';
import { cn } from '@/lib/cn';
import { formatKopecks } from '@/lib/money';
import { usePersonSwitch } from '@/lib/usePersonSwitch';
import { useSession } from '@/lib/useSession';

/**
 * Что клиент выбрал в сетке: стол, начало и длительность (решение владельца
 * от 30.09.2026 — отрезок выбирается щелчками по сетке и закрашивается).
 */
type Pick = GridPick;

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

  const roles = session.status === 'ready' ? rolesInClub(session.user, slug) : [];
  const sparring = roles.includes('COACH');
  const [sparrings, setSparrings] = useState<ClientBooking[] | null>(null);
  // Спарринг с учеником (решение владельца от 26.09.2026): ученик платит цену
  // типа. Без ученика — стол под спарринг на тренере, как прежде.
  const [sparringTypes, setSparringTypes] = useState<SparringType[]>([]);
  const [student, setStudent] = useState<SparringStudent | null>(null);
  const [sparringTypeId, setSparringTypeId] = useState('');
  const withStudent = sparring && student !== null && sparringTypeId !== '';

  const [halls, setHalls] = useState<Hall[] | null>(null);
  const [hallId, setHallId] = useState('');
  const [date, setDate] = useState('');
  const [day, setDay] = useState<PublicDayBoard | null>(null);
  const [event, setEvent] = useState<NonNullable<PublicBoardBlock['event']> | null>(null);

  const [pick, setPick] = useState<Pick | null>(null);
  const [withRobot, setWithRobot] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const anonymous = session.status === 'anonymous';

  useEffect(() => {
    club
      .bookingHalls()
      .then((loaded) => {
        setHalls(loaded);
        // «Забронировать в этом зале» со страницы клуба приходит с ?hall=.
        // Из адреса читается здесь, а не через useSearchParams: страница
        // обходится без границы Suspense, как и переключатель «за кого».
        const wanted = new URLSearchParams(window.location.search).get('hall');
        const preset = loaded.find((hall) => hall.id === wanted)?.id;
        setHallId((current) => current || preset || (loaded[0]?.id ?? ''));
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
    loadDay();
  }, [loadDay]);

  const hall = halls?.find((item) => item.id === hallId) ?? null;
  const table = day?.tables.find((item) => item.tableId === pick?.tableId) ?? null;

  const durations = useMemo(
    () => (day && table && pick ? durationsFrom(day, table, pick.startMinute) : []),
    [day, table, pick],
  );

  // Длительность — часть выбора; если она перестала помещаться (сетку
  // перечитали, стол заняли), берётся самая короткая доступная.
  const chosenDuration = pick && durations.includes(pick.durationMinutes) ? pick.durationMinutes : (durations[0] ?? 0);
  // Сетка закрашивает то, что уйдёт на сервер, а не то, что было выбрано.
  const shownPick = pick && chosenDuration > 0 ? { ...pick, durationMinutes: chosenDuration } : null;

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

    // Спарринг с учеником стоит по типу — эту цену тоже считает сервер.
    (withStudent
      ? club.sparringQuote(sparringTypeId, chosenDuration)
      : club.bookingQuote(hallId, chosenDuration, withRobot && (hall?.hasRobotOption ?? false))
    )
      .then((loaded) => {
        if (!cancelled) setQuote(loaded);
      })
      .catch(() => {
        if (!cancelled) setQuote(null);
      });

    return () => {
      cancelled = true;
    };
  }, [hallId, chosenDuration, withRobot, hall?.hasRobotOption, club, withStudent, sparringTypeId]);

  useEffect(() => {
    if (!sparring) return;

    club
      .sparringTypes()
      .then(setSparringTypes)
      .catch(() => setSparringTypes([]));
  }, [club, sparring]);

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
      withRobot: withRobot && (hall?.hasRobotOption ?? false) && !withStudent,
    };

    try {
      if (sparring) {
        await club.createSparring(
          withStudent ? { ...payload, studentId: student!.id, sparringTypeId } : payload,
        );
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
          description="Щёлкните клетку начала, затем клетку конца на том же столе — отрезок закрасится. Занятое подписано: аренда, занятие, турнир; на занятие и турнир можно нажать — откроется запись."
        />
        <CardBody>
          {day && day.tables.length > 0 ? (
            <>
              <Legend />
              <Grid
                day={day}
                pick={shownPick}
                onCell={(target, minute) => setPick(pickAfterClick(day, target, shownPick, minute))}
                onEvent={setEvent}
              />
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
            description={`${table.label}, ${formatDate(day.date)}, с ${formatMinute(pick.startMinute)} до ${formatMinute(pick.startMinute + chosenDuration)}.`}
          />
          <CardBody>
            <div className="grid gap-x-6 sm:grid-cols-2">
              <Select
                label="Длительность"
                hint="Или щёлкните в сетке клетку ниже на этом же столе — отрезок продлится до неё."
                value={String(chosenDuration)}
                onChange={(event) => setPick({ ...pick, durationMinutes: Number(event.target.value) })}
                options={durations.map((value) => ({
                  value: String(value),
                  label: formatDuration(value),
                }))}
              />

              {hall?.hasRobotOption && !withStudent && (
                <Toggle
                  label="Со столовым роботом"
                  hint="Отдельная услуга со своей ценой, а не наценка поверх аренды."
                  checked={withRobot}
                  onChange={(event) => setWithRobot(event.target.checked)}
                />
              )}
            </div>

            {sparring && !anonymous && (
              <SparringStudentPicker
                types={sparringTypes}
                student={student}
                typeId={sparringTypeId}
                onStudent={setStudent}
                onType={setSparringTypeId}
              />
            )}

            <p className="mb-5 text-[0.9375rem]">
              {withStudent ? 'Стоимость для ученика:' : 'Стоимость:'}{' '}
              <span className="text-lg text-text">
                {quote === null ? '—' : formatKopecks(quote.price)}
              </span>
              {!withStudent && quote !== null && quote.billedMinutes !== quote.durationMinutes && (
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
                disabled={
                  chosenDuration === 0 ||
                  (!sparring && family.selfIsChild) ||
                  (sparring && student !== null && sparringTypeId === '')
                }
              >
                {sparring ? (withStudent ? 'Записать на спарринг' : 'Взять стол') : 'Забронировать'}
              </Button>
            )}
          </CardBody>
        </Card>
      )}

      {sparring && (
        <Card className="mt-6">
          <CardHeader
            title="Мои спарринги"
            description="С учеником — он видит спарринг в «Моих записях» и платит цену типа. Без ученика стол занят на вас."
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
                      {booking.sparring?.partner ?? 'Без ученика'}
                      {booking.sparring?.typeName && (
                        <span className="text-text-muted"> · {booking.sparring.typeName}</span>
                      )}
                      <span className="mt-0.5 block text-[0.8125rem] text-text-muted">
                        {booking.tableLabel} · {booking.hallName} · {formatKopecks(booking.price)}
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

/**
 * Сетка «время × столы».
 *
 * Столбцами идут столы, строками — время: столов в зале единицы, а строк
 * времени десятки, и вертикальная прокрутка привычнее горизонтальной.
 *
 * Занятое — цельными прямоугольниками поверх клеток (решение владельца от
 * 30.09.2026): тренировка на четырёх столах на два часа — один блок в цвете
 * своего вида, с названием шрифтом платформы, и он открывает окно
 * мероприятия, где можно записаться. Склейку решает `blockSpans`.
 */
function Grid({
  day,
  pick,
  onCell,
  onEvent,
}: {
  day: PublicDayBoard;
  pick: Pick | null;
  /** Щелчок по свободной клетке — что станет с выбором, решает `pickAfterClick`. */
  onCell: (table: PublicBoardTable, startMinute: number) => void;
  onEvent: (event: NonNullable<PublicBoardBlock['event']>) => void;
}) {
  // Прошедшие клетки не рисуются вовсе: вечером они занимали три четверти
  // сетки, и человек скроллил мимо серого к своему времени.
  const rows = useMemo(() => bookableMinutes(day), [day]);
  const spans = useMemo(() => blockSpans(day.tables, rows, day.stepMinutes), [day, rows]);

  if (rows.length === 0) {
    return (
      <p className="text-[0.9375rem] text-text-muted">
        На сегодня время в этом зале уже кончилось — выберите другой день.
      </p>
    );
  }

  // Клетки под блоками не рисуются: их место занимает сам блок.
  const covered = new Set<string>();
  for (const span of spans) {
    for (let table = span.firstTable; table <= span.lastTable; table += 1) {
      for (let row = span.rowStart; row < span.rowEnd; row += 1) covered.add(`${table}:${row}`);
    }
  }

  return (
    // Своя область прокрутки с прилипающей шапкой — как в расписании у
    // администратора: столов бывает дюжина, строк времени четыре десятка, и без
    // шапки столбцы на длинной сетке теряют имена.
    <div className="max-h-[calc(100dvh-16rem)] touch-pan-y overflow-auto">
      <div
        className="grid text-[0.8125rem]"
        style={{
          gridTemplateColumns: `4rem repeat(${day.tables.length}, minmax(0, 1fr))`,
          gridTemplateRows: `auto repeat(${rows.length}, 1.75rem)`,
        }}
        role="grid"
        aria-label="Сетка зала"
      >
        <div className="sticky top-0 z-20 bg-surface-raised py-2 text-left font-medium text-text-subtle" style={{ gridRow: 1, gridColumn: 1 }}>
          Время
        </div>
        {day.tables.map((table, index) => (
          <div
            key={table.tableId}
            className="sticky top-0 z-20 bg-surface-raised px-1 py-2 text-center font-medium text-text-muted"
            style={{ gridRow: 1, gridColumn: index + 2 }}
          >
            {table.label}
          </div>
        ))}

        {rows.map((startMinute, rowIndex) => (
          <Fragment key={startMinute}>
            {/* Подписан каждый час, а не каждая клетка: при шаге в десять
                минут подписи слились бы в сплошной столбец цифр. */}
            <div
              className="self-center pr-2 text-text-subtle tabular-nums"
              style={{ gridRow: rowIndex + 2, gridColumn: 1 }}
            >
              {startMinute % 60 === 0 ? formatMinute(startMinute) : ''}
            </div>

            {day.tables.map((table, tableIndex) =>
              covered.has(`${tableIndex}:${rowIndex}`) ? null : (
                <Cell
                  key={table.tableId}
                  day={day}
                  table={table}
                  startMinute={startMinute}
                  row={rowIndex + 2}
                  column={tableIndex + 2}
                  part={pickPart(pick, table.tableId, startMinute)}
                  lastPicked={
                    pick !== null &&
                    pick.tableId === table.tableId &&
                    startMinute + day.stepMinutes === pick.startMinute + pick.durationMinutes
                  }
                  onCell={onCell}
                />
              ),
            )}
          </Fragment>
        ))}

        {spans.map((span) => (
          <BlockTile
            key={`${span.firstTable}-${span.rowStart}-${span.block.startMinute}-${span.block.title}`}
            span={span}
            tables={day.tables}
            onEvent={onEvent}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Занятое одним прямоугольником: заливка цвета вида, кромка слева, название
 * шрифтом платформы, ниже — тренер и время. Занятие и турнир дня открывают
 * окно мероприятия; аренда и закрытие — просто подписаны.
 */
function BlockTile({
  span,
  tables,
  onEvent,
}: {
  span: BlockSpan<PublicBoardBlock>;
  tables: PublicBoardTable[];
  onEvent: (event: NonNullable<PublicBoardBlock['event']>) => void;
}) {
  const { block } = span;
  const paint = KIND_PAINT[block.kind];
  const target = block.event;
  const rowsTall = span.rowEnd - span.rowStart;
  const tableNames =
    span.firstTable === span.lastTable
      ? tables[span.firstTable]!.label
      : `${tables[span.firstTable]!.label} — ${tables[span.lastTable]!.label}`;
  const time = `${formatMinute(block.startMinute)}–${formatMinute(block.endMinute)}`;
  const reason = [block.title, block.subtitle, time, tableNames].filter(Boolean).join(', ');

  const body = (
    <span className="flex h-full min-w-0 flex-col justify-start overflow-hidden px-2 py-1 text-left">
      <span className="truncate font-display text-[0.75rem] leading-snug text-text sm:text-[0.8125rem]">
        {block.title}
      </span>
      {rowsTall >= 2 && (
        <span className="truncate text-[0.6875rem] leading-snug text-text-muted">
          {[block.subtitle, time].filter(Boolean).join(' · ')}
        </span>
      )}
    </span>
  );

  const className = 'm-0.5 rounded-[6px] border-l-[3px]';
  const style = {
    gridColumn: `${span.firstTable + 2} / ${span.lastTable + 3}`,
    gridRow: `${span.rowStart + 2} / ${span.rowEnd + 2}`,
    background: tintFill(paint),
    borderLeftColor: tintMark(paint),
  };

  if (target) {
    return (
      <button
        type="button"
        title={`${reason} — открыть`}
        aria-label={`${reason}. Открыть мероприятие`}
        onClick={() => onEvent(target)}
        className={cn(className, 'transition-[filter] hover:brightness-110 focus-visible:brightness-110')}
        style={style}
      >
        {body}
      </button>
    );
  }

  return (
    <span role="img" title={reason} aria-label={reason} className={cn(className, 'cursor-not-allowed')} style={style}>
      {body}
    </span>
  );
}

function Cell({
  day,
  table,
  startMinute,
  row,
  column,
  part,
  lastPicked,
  onCell,
}: {
  day: PublicDayBoard;
  table: PublicBoardTable;
  startMinute: number;
  /** Место в CSS-сетке. */
  row: number;
  column: number;
  /** Клетка в выбранном отрезке: его начало или продолжение. */
  part: 'start' | 'inside' | null;
  /** Последняя клетка отрезка — скругление снизу. */
  lastPicked: boolean;
  onCell: (table: PublicBoardTable, startMinute: number) => void;
}) {
  const state = cellState(day, table, startMinute);
  const available = state === 'free';
  const picked = part !== null;

  return (
    <div className={cn('px-0.5', picked ? 'py-0' : 'py-0.5')} style={{ gridRow: row, gridColumn: column }}>
      <button
        type="button"
        disabled={!available}
        aria-pressed={picked}
        // «Занято» и «прошло» — разные ответы, и диктор должен называть их
        // по-разному: утренняя клетка сегодняшнего дня свободна, просто утро
        // кончилось.
        aria-label={`${table.label}, ${formatMinute(startMinute)}${LABELS[state]}`}
        onClick={() => onCell(table, startMinute)}
        className={cn(
          'h-full w-full transition-colors',
          // Выбранный отрезок — сплошной полосой: клетки внутри без зазоров,
          // скругление только у первой и последней.
          part === null && 'rounded-[3px]',
          part === 'start' && cn('bg-accent', lastPicked ? 'rounded-[3px]' : 'rounded-t-[3px]'),
          part === 'inside' && cn('bg-accent/65', lastPicked && 'rounded-b-[3px]'),
          state === 'free' && !picked && 'bg-surface-sunken hover:bg-surface-accent-soft',
          // Занятое — плотнее прошедшего: за ним стоит чужая бронь, и его
          // стоит замечать, выбирая соседнее время.
          state === 'busy' && 'cursor-not-allowed bg-border/60',
          state === 'past' && 'cursor-not-allowed bg-surface-sunken/40',
        )}
      />
    </div>
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
