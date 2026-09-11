'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ClubPerson, DeskBooking, DeskDay, Hall } from '@yenisey/types';
import { ClientPicker } from '@/components/club/ClientPicker';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { inputClassName } from '@/components/ui/Field';
import { ApiError } from '@/lib/api';
import { formatDate, formatDuration, STEP_MINUTES } from '@/lib/bookingGrid';
import { cn } from '@/lib/cn';
import { formatKopecks } from '@/lib/money';
import { useClubApi } from '@/lib/useClubApi';

/**
 * Посадить человека за стол — то, ради чего рабочее место и писалось.
 *
 * Порядок полей повторяет порядок решения, как и в клиентской форме: кто →
 * куда → когда → сколько. Цена приходит последней и с сервера.
 *
 * Время вводится, а не выбирается из сетки, и это отличие от клиентской формы
 * намеренное. Клиенту сетка нужна, потому что он не знает, что в зале
 * свободно; администратор знает — он на этот зал смотрит. Сетка же показала бы
 * ему закрытое расписанием время недоступным, а посадить туда человека он
 * вправе. Отказ, если стол всё-таки занят чужой бронью, придёт от сервера
 * внятной строкой.
 */
export function BookingDialog({
  day,
  hall,
  onClose,
  onCreated,
}: {
  day: DeskDay;
  hall: Hall;
  onClose: () => void;
  onCreated: (booking: DeskBooking) => void;
}) {
  const club = useClubApi();

  const [client, setClient] = useState<ClubPerson | null>(null);
  const [tableId, setTableId] = useState(day.tables[0]?.tableId ?? '');
  const [time, setTime] = useState(suggestedTime(day));
  const [duration, setDuration] = useState(60);
  const [withRobot, setWithRobot] = useState(false);

  const [price, setPrice] = useState<number | null>(null);
  const [billedMinutes, setBilledMinutes] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const step = STEP_MINUTES[hall.bookingStep];

  const durations = useMemo(
    () => Array.from({ length: Math.floor(240 / step) }, (_, index) => (index + 1) * step),
    [step],
  );

  // Длительность держим кратной шагу зала: сервер всё равно отклонит некратную,
  // и узнать об этом после нажатия «Посадить» — не тот порядок.
  useEffect(() => {
    setDuration((current) => (current % step === 0 ? current : step));
  }, [step]);

  /**
   * Цену считает сервер, и только он.
   *
   * Тот же маршрут, что у клиентской формы: он открыт любой вошедшей роли —
   * прайс клуб и так показывает на стене. Второго расчёта здесь быть не должно:
   * разойдясь однажды, две формулы разойдутся молча.
   */
  useEffect(() => {
    let cancelled = false;

    club
      .bookingQuote(day.hallId, duration, withRobot && hall.hasRobotOption)
      .then((quote) => {
        if (cancelled) return;
        setPrice(quote.price);
        setBilledMinutes(quote.billedMinutes);
      })
      .catch(() => {
        if (!cancelled) setPrice(null);
      });

    return () => {
      cancelled = true;
    };
  }, [club, day.hallId, duration, withRobot, hall.hasRobotOption]);

  // Закрытие по Escape: окно перекрывает экран смены, и мышью до него
  // добираться дольше, чем клавишей.
  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);

  async function submit(): Promise<void> {
    if (!client || !tableId) return;

    setPending(true);
    setError(null);

    try {
      onCreated(
        await club.createDeskBooking({
          clientId: client.id,
          tableId,
          startsAt: instantAt(day.date, time, day.timezone),
          durationMinutes: duration,
          withRobot: withRobot && hall.hasRobotOption,
        }),
      );
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером');
    } finally {
      setPending(false);
    }
  }

  return (
    // Затемнение — краской из палитры, а не утилитой: в @theme inline
    // выведены только семантические роли, шкала --ink-* в классы не попадает.
    <div
      className="fixed inset-0 z-40 overflow-y-auto px-4 py-10"
      style={{ background: 'color-mix(in oklab, var(--ink-950) 45%, transparent)' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="seat-title"
        className="mx-auto w-full max-w-lg rounded-card border border-border bg-surface-raised shadow-lg"
      >
        <div className="border-b border-border px-6 py-5">
          <h2 id="seat-title" className="text-[1.0625rem]">
            Посадить клиента
          </h2>
          <p className="mt-1 text-[0.875rem] text-text-muted">
            {day.hallName} · {formatDate(day.date)}. Бронь заведётся от имени человека — он увидит
            её в «Моих записях» и сможет отменить сам.
          </p>
        </div>

        <div className="grid gap-5 px-6 py-5">
          {error && <Alert>{error}</Alert>}

          <ClientPicker value={client} onChange={setClient} label="Кто играет" />

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-[0.875rem]">
              <span className="font-medium text-text">Стол</span>
              <select
                value={tableId}
                onChange={(event) => setTableId(event.target.value)}
                className={inputClassName}
              >
                {day.tables.map((table) => (
                  <option key={table.tableId} value={table.tableId}>
                    {table.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5 text-[0.875rem]">
              <span className="font-medium text-text">Начало</span>
              <input
                type="time"
                value={time}
                step={step * 60}
                onChange={(event) => setTime(event.target.value)}
                className={inputClassName}
              />
            </label>

            <label className="grid gap-1.5 text-[0.875rem]">
              <span className="font-medium text-text">Длительность</span>
              <select
                value={String(duration)}
                onChange={(event) => setDuration(Number(event.target.value))}
                className={inputClassName}
              >
                {durations.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {formatDuration(minutes)}
                  </option>
                ))}
              </select>
            </label>

            {hall.hasRobotOption && (
              <label className="flex items-start gap-2.5 self-end pb-2">
                <input
                  type="checkbox"
                  checked={withRobot}
                  onChange={(event) => setWithRobot(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-accent"
                />
                <span>
                  <span className="block text-[0.875rem] font-medium">Со столовым роботом</span>
                  <span className="block text-[0.8125rem] text-text-subtle">
                    Отдельная услуга со своей ценой.
                  </span>
                </span>
              </label>
            )}
          </div>

          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-control border border-border bg-surface-sunken px-4 py-3.5">
            <span className="font-display text-[1.5rem] tabular-nums">
              {price === null ? '—' : formatKopecks(price)}
            </span>
            <span className="flex-1 text-[0.8125rem] text-text-muted">
              {billedMinutes !== null && billedMinutes !== duration
                ? `Оплачивается ${formatDuration(billedMinutes)}: начатые полчаса считаются полными. `
                : ''}
              Сумму вернул сервер — форма её не считает.
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button onClick={() => void submit()} pending={pending} disabled={!client || !tableId}>
              Посадить
            </Button>
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              Отмена
            </Button>

            <span
              className={cn(
                'ml-auto rounded-full border border-dashed border-border px-2.5 py-1',
                'text-[0.75rem] tracking-[0.04em] text-text-muted uppercase',
              )}
            >
              запишется как «завёл админ»
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * С какого времени предлагать бронь.
 *
 * На сегодняшнем дне — ближайший круглый час вперёд: чаще всего сажают «на
 * сейчас» или «на вечер», и попадать пальцем в поле с полуночи неудобно. На
 * прочих днях — начало вечернего пика, когда зал и работает.
 */
function suggestedTime(day: DeskDay): string {
  const minute = day.nowMinute === null ? 18 * 60 : Math.ceil((day.nowMinute + 1) / 60) * 60;
  const clamped = Math.min(Math.max(minute, day.openMinute), day.closeMinute - 60);

  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/**
 * Местные дата и время зала → мгновение в ISO-8601.
 *
 * Считается подбором смещения: перевести мгновение в зону браузер умеет, а
 * собрать мгновение из местных даты и часа — нет. Та же арифметика, что в
 * `instantAt` на сервере, и сервер всё равно проверяет результат.
 */
function instantAt(date: string, time: string, timezone: string): string {
  const [hours = '0', minutes = '0'] = time.split(':');
  const target = Date.parse(`${date}T00:00:00Z`) + (Number(hours) * 60 + Number(minutes)) * 60_000;
  let instant = new Date(target);

  for (let pass = 0; pass < 2; pass += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);

    const value = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((part) => part.type === type)?.value ?? '';

    const actual =
      Date.parse(`${value('year')}-${value('month')}-${value('day')}T00:00:00Z`) +
      (Number(value('hour')) * 60 + Number(value('minute'))) * 60_000;

    if (actual === target) break;

    instant = new Date(instant.getTime() - (actual - target));
  }

  return instant.toISOString();
}
