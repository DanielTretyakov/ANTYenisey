'use client';

import { useState } from 'react';
import type { AttendancePhase, DeskBooking, DeskDay, DeskEvent } from '@yenisey/types';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { markLabel, PHASE_LABELS } from '@/lib/attendance';
import { cn } from '@/lib/cn';
import { useClubApi } from '@/lib/useClubApi';
import { MarkButtons } from './MarkButtons';
import { clockIn, dateIn, momentIn } from './time';

/**
 * «Требует отметки» — всё неотмеченное клуба, что уже началось.
 *
 * По всему клубу, а не по залу и дню на экране: вчерашнее и мероприятие,
 * заведённое не в сетке, лента дня не видит, и без общего списка их не отметил
 * бы никто, кроме джобы. А джоба ставит неявку — человеку, который был,
 * спишут всю цену.
 *
 * Список собирает сервер, фазу считает он же: по часам браузера запись могла
 * бы казаться просроченной, когда джоба ещё на неё не смотрит.
 */
export function PendingBlock({ day, onChanged }: { day: DeskDay; onChanged: () => void }) {
  const { bookings, events } = day.pending;

  if (bookings.length === 0 && events.length === 0) {
    return null;
  }

  return (
    <Card className="border-warning-border">
      <CardHeader
        title="Требует отметки"
        description="Началось, а пришёл человек или нет — не записано. Здесь всё неотмеченное клуба, а не только этого зала и дня. Что не отметить, система через сутки после окончания закроет неявкой со списанием."
      />

      <ul className="divide-y divide-border">
        {bookings.map((booking) => (
          <li key={`booking-${booking.id}`} className="px-6 py-3.5">
            <BookingItem booking={booking} day={day} onChanged={onChanged} />
          </li>
        ))}

        {events.map((event) => (
          <li key={`event-${event.id}`} className="px-6 py-3.5">
            <EventItem event={event} day={day} onChanged={onChanged} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function BookingItem({
  booking,
  day,
  onChanged,
}: {
  booking: DeskBooking;
  day: DeskDay;
  onChanged: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <Moment at={booking.startsAt} note={booking.withRobot ? 'робот' : 'аренда'} day={day} />

      <span className="min-w-[12rem] flex-1">
        <span className="block text-[0.9375rem]">
          {booking.client.fullName} · {booking.tableLabel}
          {booking.hallId !== day.hallId ? ` · ${booking.hallName}` : ''}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.8125rem] text-text-muted">
          <span>{booking.client.phone}</span>
          <Phase phase={booking.phase} autoNoShowAt={booking.autoNoShowAt} day={day} />
        </span>
      </span>

      <MarkButtons
        kind="TABLE"
        entryId={booking.id}
        noShowPercent={day.policy.noShowChargePercent}
        onDone={onChanged}
      />
    </div>
  );
}

function EventItem({
  event,
  day,
  onChanged,
}: {
  event: DeskEvent;
  day: DeskDay;
  onChanged: () => void;
}) {
  const waiting = event.participants.filter((entry) => entry.status === 'BOOKED');

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Moment at={event.startsAt} note={event.kind === 'TRAINING' ? 'занятие' : 'турнир'} day={day} />

        <span className="min-w-[12rem] flex-1">
          <span className="block text-[0.9375rem]">
            {[event.title, event.coachName].filter(Boolean).join(' · ')}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.8125rem] text-text-muted">
            <span>
              ждут отметки {waiting.length} из {event.participants.length}
            </span>
            <Phase phase={event.phase} autoNoShowAt={event.autoNoShowAt} day={day} />
          </span>
        </span>

        {waiting.length > 1 && <MarkAll event={event} waiting={waiting.length} onDone={onChanged} />}
      </div>

      <ul className="mt-2.5 grid gap-1.5 border-l-2 border-border pl-4 sm:ml-[5.75rem]">
        {event.participants.map((entry) => (
          <li
            key={entry.entryId}
            className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.875rem]"
          >
            <span className="min-w-[12rem] flex-1">
              {entry.fullName}{' '}
              <span className="text-[0.8125rem] text-text-subtle">{entry.phone}</span>
            </span>

            {entry.status === 'BOOKED' ? (
              <MarkButtons
                kind={event.kind}
                entryId={entry.entryId}
                noShowPercent={day.policy.noShowChargePercent}
                onDone={onChanged}
              />
            ) : (
              <span className="text-[0.8125rem] text-text-muted">
                {markLabel(entry.status, entry.chargePercent)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * «Отметить всех пришедшими» — с подтверждением.
 *
 * Отмечаются только ждущие: исправлять уже поставленную неявку массовой
 * кнопкой нельзя — исправление требует причины. Сервер делает это одной
 * транзакцией: либо отмечены все, либо никто.
 */
function MarkAll({ event, waiting, onDone }: { event: DeskEvent; waiting: number; onDone: () => void }) {
  const club = useClubApi();
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markAll(): Promise<void> {
    setPending(true);
    setError(null);

    try {
      await club.markAttendanceBatch({
        marks: event.participants
          .filter((entry) => entry.status === 'BOOKED')
          .map((entry) => ({ kind: event.kind, entryId: entry.entryId, status: 'ATTENDED' as const })),
      });
      setAsking(false);
      onDone();
    } catch (cause: unknown) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером');
    } finally {
      setPending(false);
    }
  }

  if (!asking) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setAsking(true)}>
        Отметить всех пришедшими
      </Button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
      <span className="text-text-muted">Пришли все {waiting}?</span>
      <Button size="sm" pending={pending} onClick={() => void markAll()}>
        Да, все пришли
      </Button>
      <button
        type="button"
        onClick={() => setAsking(false)}
        className="text-text-subtle underline underline-offset-2 hover:text-text"
      >
        не надо
      </button>
      {error && <span className="basis-full text-danger">{error}</span>}
    </span>
  );
}

/** Время начала, а у записи другого дня — ещё и дата: список общий на клуб. */
function Moment({ at, note, day }: { at: string; note: string; day: DeskDay }) {
  const date = dateIn(at, day.timezone);

  return (
    <span className="grid min-w-[4.5rem] tabular-nums">
      <span className="font-display text-[1.0625rem] leading-tight">{clockIn(at, day.timezone)}</span>
      <span className="text-[0.75rem] text-text-subtle">
        {date === day.date ? note : `${note}, ${date.slice(8, 10)}.${date.slice(5, 7)}`}
      </span>
    </span>
  );
}

/**
 * Фаза записи и срок, когда система закроет её сама.
 *
 * «Просрочено» — единственное напоминание, которое есть: Telegram и
 * уведомления в браузер не подключены, и ТЗ-шное «напомнить через час»
 * живёт подсветкой здесь.
 */
function Phase({
  phase,
  autoNoShowAt,
  day,
}: {
  phase: AttendancePhase;
  autoNoShowAt: string | null;
  day: DeskDay;
}) {
  const overdue = phase === 'OVERDUE';

  return (
    <>
      <span
        className={cn(
          'rounded-full border px-2 py-px text-[0.75rem]',
          overdue ? 'border-warning-border bg-warning-soft text-warning' : 'border-border text-text-subtle',
        )}
      >
        {PHASE_LABELS[phase]}
      </span>

      {autoNoShowAt && (
        <span className="text-[0.75rem] text-text-subtle">
          неявку система поставит {momentIn(autoNoShowAt, day.timezone, day.date)}
        </span>
      )}
    </>
  );
}
