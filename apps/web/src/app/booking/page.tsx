'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BOOKING_HORIZON_DAYS,
  type BookingDay,
  type BookingDayTable,
  type BookingQuote,
  type Hall,
} from '@yenisey/types';
import { AppShell } from '@/components/layout/AppShell';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { api, ApiError } from '@/lib/api';
import {
  bookableDates,
  durationsFrom,
  formatDate,
  formatDuration,
  formatMinute,
  gridMinutes,
  isAvailable,
  todayIn,
} from '@/lib/bookingGrid';
import { cn } from '@/lib/cn';
import { TENANT_SLUG } from '@/lib/config';
import { formatKopecks } from '@/lib/money';
import { useSession } from '@/lib/useSession';

/** Что клиент выбрал в сетке: стол и начало отрезка. */
interface Pick {
  tableId: string;
  startMinute: number;
}

/**
 * Бронь стола клиентом.
 *
 * Порядок экрана повторяет порядок решения: сначала зал, потом день, потом
 * время. Обратный — «выберите время, а потом посмотрим, в каком зале» — не
 * работает: цены и шаг брони у залов разные, и без зала сетку не построить.
 *
 * Цена показывается до подтверждения. Узнать сумму после того, как бронь уже
 * заведена, — не тот порядок, даже пока за ней не стоит холд.
 */
export default function BookingPage() {
  const router = useRouter();
  const session = useSession();

  const [timezone, setTimezone] = useState<string | null>(null);
  const [halls, setHalls] = useState<Hall[] | null>(null);
  const [hallId, setHallId] = useState('');
  const [date, setDate] = useState('');
  const [day, setDay] = useState<BookingDay | null>(null);

  const [pick, setPick] = useState<Pick | null>(null);
  const [duration, setDuration] = useState(0);
  const [withRobot, setWithRobot] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (session.status === 'anonymous') {
      router.replace('/login');
    }
  }, [session.status, router]);

  // Часовой пояс клуба — до всего остального: «сегодня» у зала своё, и
  // считать его по часам браузера значит открыть клиенту из другого пояса не
  // тот день.
  useEffect(() => {
    api
      .tenant(TENANT_SLUG)
      .then((tenant) => setTimezone(tenant.timezone))
      .catch(() => setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone));
  }, []);

  useEffect(() => {
    if (session.status !== 'ready') {
      return;
    }

    api
      .bookingHalls()
      .then((loaded) => {
        setHalls(loaded);
        setHallId((current) => current || (loaded[0]?.id ?? ''));
      })
      .catch((cause: unknown) => setError(messageOf(cause)));
  }, [session.status]);

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

    api
      .bookingDay(hallId, date)
      .then((loaded) => {
        setDay(loaded);
        setError(null);
      })
      .catch((cause: unknown) => {
        setDay(null);
        setError(messageOf(cause));
      });
  }, [hallId, date]);

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

    api
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
  }, [hallId, chosenDuration, withRobot, hall?.hasRobotOption]);

  async function handleBook(): Promise<void> {
    if (!day || !pick || !timezone || chosenDuration === 0) {
      return;
    }

    setPending(true);
    setError(null);

    try {
      await api.createBooking({
        tableId: pick.tableId,
        startsAt: instantAt(day.date, pick.startMinute, timezone),
        durationMinutes: chosenDuration,
        withRobot: withRobot && (hall?.hasRobotOption ?? false),
      });

      router.push('/cabinet');
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
      <h1 className="mb-7 text-[1.75rem]">Забронировать стол</h1>

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
          description="Серым отмечено занятое и уже прошедшее время."
        />
        <CardBody>
          {day && day.tables.length > 0 ? (
            <Grid day={day} pick={pick} onPick={setPick} />
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

            <Button
              onClick={() => void handleBook()}
              pending={pending}
              disabled={chosenDuration === 0}
            >
              Забронировать
            </Button>
          </CardBody>
        </Card>
      )}
    </AppShell>
  );
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
}: {
  day: BookingDay;
  pick: Pick | null;
  onPick: (pick: Pick | null) => void;
}) {
  const rows = gridMinutes(day);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-[0.8125rem]">
        <thead>
          <tr>
            <th className="w-16 py-2 text-left font-medium text-text-subtle">Время</th>
            {day.tables.map((table) => (
              <th key={table.tableId} className="px-1 py-2 font-medium text-text-muted">
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
                  picked={pick?.tableId === table.tableId && pick.startMinute === startMinute}
                  onPick={onPick}
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
  picked,
  onPick,
}: {
  day: BookingDay;
  table: BookingDayTable;
  startMinute: number;
  picked: boolean;
  onPick: (pick: Pick | null) => void;
}) {
  const available = isAvailable(day, table, startMinute);

  return (
    <td className="px-0.5 py-0.5">
      <button
        type="button"
        disabled={!available}
        aria-pressed={picked}
        aria-label={`${table.label}, ${formatMinute(startMinute)}${available ? '' : ', занято'}`}
        onClick={() => onPick(picked ? null : { tableId: table.tableId, startMinute })}
        className={cn(
          'h-6 w-full rounded-[3px] transition-colors',
          picked && 'bg-accent',
          !picked && available && 'bg-surface-sunken hover:bg-surface-accent-soft',
          !available && 'cursor-not-allowed bg-surface-sunken/40',
        )}
      />
    </td>
  );
}

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
