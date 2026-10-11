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
import { PersonLink } from './PersonLink';
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
  const groups = pendingDays(day);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [full, setFull] = useState<Set<string>>(new Set());

  if (groups.length === 0) {
    return null;
  }

  const toggle = (set: Set<string>, key: string): Set<string> => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  return (
    <Card className="border-warning-border">
      <CardHeader
        title="Требует отметки"
        description="Началось, а пришёл человек или нет — не записано. Здесь всё неотмеченное клуба, а не только этого зала и дня. Что не отметить, система через сутки после окончания закроет неявкой со списанием."
      />

      {/* По дням (решение владельца от 11.10.2026): сегодня раскрыт, прошлые
          дни свёрнуты строкой со счётчиком и сроком — раньше всё неотмеченное
          шло одной лентой без дат, сперва все аренды, потом все занятия, и
          выталкивало «Сейчас» и ленту дня на несколько экранов вниз. */}
      <ul className="divide-y divide-border">
        {groups.map((group) => {
          const open = group.date === day.date || opened.has(group.date);
          const shown = open && !full.has(group.date) ? group.items.slice(0, ROWS_SHOWN) : group.items;
          const hidden = group.items.length - shown.length;

          return (
            <li key={group.date}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-surface-sunken/50 px-6 py-2.5 text-[0.8125rem]">
                <span className="font-medium text-text">{group.label}</span>
                <span className="text-text-muted">
                  ждут отметки: {group.waiting}
                </span>
                {group.overdue && (
                  <span className="rounded-full border border-warning-border bg-warning-soft px-2 py-px text-[0.75rem] text-warning">
                    просрочено
                  </span>
                )}
                {group.date !== day.date && (
                  <button
                    type="button"
                    onClick={() => setOpened((set) => toggle(set, group.date))}
                    className="ml-auto text-text-accent underline-offset-2 hover:underline"
                    aria-expanded={open}
                  >
                    {open ? 'Свернуть' : 'Показать'}
                  </button>
                )}
              </div>

              {open && (
                <ul className="divide-y divide-border">
                  {shown.map((item) => (
                    <li key={item.key} className="px-6 py-3.5">
                      {item.booking ? (
                        <BookingItem booking={item.booking} day={day} onChanged={onChanged} />
                      ) : (
                        <EventItem event={item.event!} day={day} onChanged={onChanged} />
                      )}
                    </li>
                  ))}
                  {hidden > 0 && (
                    <li className="px-6 py-2.5">
                      <button
                        type="button"
                        onClick={() => setFull((set) => toggle(set, group.date))}
                        className="text-[0.8125rem] text-text-accent underline-offset-2 hover:underline"
                      >
                        Ещё {hidden}
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Строк в раскрытом дне, остальное — под «Ещё N». */
const ROWS_SHOWN = 6;

interface PendingItem {
  key: string;
  at: string;
  booking?: DeskBooking;
  event?: DeskEvent;
}

interface PendingDay {
  /** Местная дата зала смены. */
  date: string;
  label: string;
  items: PendingItem[];
  /** Сколько записей ждут отметки — люди, а не строки: у занятия их много. */
  waiting: number;
  overdue: boolean;
}

/**
 * Неотмеченное по дням: сегодня первым, дальше — от свежего к старому;
 * внутри дня — по времени, аренды и занятия вперемешку.
 */
function pendingDays(day: DeskDay): PendingDay[] {
  const items: PendingItem[] = [
    ...day.pending.bookings.map((booking) => ({ key: `booking-${booking.id}`, at: booking.startsAt, booking })),
    ...day.pending.events.map((event) => ({ key: `event-${event.kind}-${event.id}`, at: event.startsAt, event })),
  ];
  const byDate = new Map<string, PendingItem[]>();

  for (const item of items) {
    const date = dateIn(item.at, day.timezone);
    byDate.set(date, [...(byDate.get(date) ?? []), item]);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => (a === day.date ? -1 : b === day.date ? 1 : b.localeCompare(a)))
    .map(([date, list]) => {
      const sorted = list.sort((a, b) => a.at.localeCompare(b.at));

      return {
        date,
        label: dayLabel(date, day.date),
        items: sorted,
        waiting: sorted.reduce(
          (sum, item) =>
            sum + (item.booking ? 1 : item.event!.participants.filter((entry) => entry.status === 'BOOKED').length),
          0,
        ),
        overdue: sorted.some((item) => (item.booking ?? item.event)!.phase === 'OVERDUE'),
      };
    });
}

/** «Сегодня» · «Вчера, 10 окт.» · «пт, 9 окт.» — дата зала. */
function dayLabel(date: string, today: string): string {
  const short = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(`${date}T00:00:00Z`),
  );
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

  return date === today ? 'Сегодня' : date === yesterday ? `Вчера, ${short}` : short;
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
          <PersonLink userId={booking.client.userId}>{booking.client.fullName}</PersonLink> ·{' '}
          {booking.tableLabel}
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
              <PersonLink userId={entry.userId}>{entry.fullName}</PersonLink>{' '}
              <span className="text-[0.8125rem] text-text-subtle">{entry.phone}</span>
            </span>

            {entry.status === 'BOOKED' ? (
              <MarkButtons
                kind={event.kind}
                entryId={entry.entryId}
                noShowPercent={day.policy.noShowChargePercent}
                bySubscription={entry.bySubscription}
                onDone={onChanged}
              />
            ) : (
              <span className="text-[0.8125rem] text-text-muted">
                {markLabel(entry.status, entry.chargePercent, entry.bySubscription)}
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
          {/* Срок в прошлом — «поставит 25.09» читалось бы как ошибка: значит,
              система вот-вот закроет запись сама. */}
          {new Date(autoNoShowAt).getTime() <= Date.now()
            ? 'срок прошёл — неявку система поставит при ближайшей проверке'
            : `неявку система поставит ${momentIn(autoNoShowAt, day.timezone, day.date)}`}
        </span>
      )}
    </>
  );
}
