'use client';

import { useId, useState, type ReactNode } from 'react';
import type { DeskDay } from '@yenisey/types';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { deskTimeline, type DeskTimelineItem } from '@/lib/deskTimeline';
import { markLabel, pendingCounts, PHASE_LABELS } from '@/lib/attendance';
import { MarkButtons } from './MarkButtons';
import { PersonLink } from './PersonLink';
import { clockIn } from './time';

/** Мобильная смена: три коротких пути вместо одной длинной страницы. */
export function MobileDesk({
  day,
  now,
  ahead,
  history,
  onSeat,
  onChanged,
}: {
  day: DeskDay;
  now: ReactNode;
  ahead: ReactNode;
  history: ReactNode;
  onSeat: () => void;
  onChanged: () => void;
}) {
  const [view, setView] = useState<'now' | 'ahead' | 'day'>('now');
  const contentId = useId();
  const timeline = deskTimeline(day);
  const nextCount = timeline.filter((item) => (item.booking ?? item.event).phase === 'UPCOMING').length;
  const pending = pendingCounts(day.pending);

  return (
    <div className="pb-24 sm:hidden [&_button]:scroll-mb-24 [&_a]:scroll-mb-24">
      <nav
        aria-label="Разделы мобильной смены"
        className="sticky top-20 z-20 mb-4 grid grid-cols-3 gap-1 rounded-control border border-border bg-surface-raised p-1"
      >
        {(
          [
            ['now', 'Сейчас'],
            ['ahead', `Далее${nextCount > 0 ? ` · ${nextCount}` : ''}`],
            ['day', 'Весь день'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={view === key}
            aria-controls={contentId}
            onClick={() => setView(key)}
            className={cn(
              'min-h-11 rounded-control px-1 text-[0.875rem] font-medium transition-colors',
              view === key ? 'bg-accent text-accent-text' : 'text-text-muted hover:bg-surface-sunken',
            )}
          >
            {label}
          </button>
        ))}
      </nav>

      <div id={contentId} className="grid min-w-0 gap-4">
        {view === 'now' && (
          <>
            {pending.total > 0 && (
              <a
                href="#mobile-desk-pending"
                className="flex min-h-11 items-center justify-between gap-2 rounded-control border border-warning-border bg-warning-soft px-3 py-2 text-[0.8125rem] text-warning"
              >
                <span>Ждут отметки: {pending.total} · весь клуб</span>
                <span aria-hidden="true">↓</span>
              </a>
            )}
            {!day.today && (
              <div className="rounded-card border border-border bg-surface-raised p-4">
                <h2 className="text-lg">Выбран другой день</h2>
                <p className="mt-2 text-[0.875rem] text-text-muted">
                  Состояние столов сейчас доступно на сегодня. Записи выбранной даты — во «Весь день».
                </p>
                <Button className="mt-3" variant="secondary" onClick={() => setView('day')}>
                  Открыть весь день
                </Button>
              </div>
            )}
            {now}
          </>
        )}
        {view === 'ahead' && ahead}
        {view === 'day' && (
          <>
            <section
              aria-label="Хронология дня"
              className="overflow-hidden rounded-card border border-border bg-surface-raised"
            >
              <div className="border-b border-border p-4">
                <h2 className="text-lg">Весь день</h2>
                <p className="mt-1 text-[0.8125rem] text-text-muted">
                  Аренды и мероприятия по времени зала. Откройте мероприятие, чтобы посмотреть состав.
                </p>
              </div>
              {timeline.length === 0 ? (
                <p className="p-4 text-[0.875rem] text-text-muted">На этот день аренд и мероприятий нет.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {timeline.map((item) => (
                    <TimelineRow key={item.key} item={item} day={day} onChanged={onChanged} />
                  ))}
                </ul>
              )}
            </section>
            {history}
          </>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface-raised py-3 pr-20 pl-5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button fullWidth onClick={onSeat}>
          <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
            <path
              d="M10 4v12M4 10h12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          Посадить клиента
        </Button>
      </div>
    </div>
  );
}

function TimelineRow({
  item,
  day,
  onChanged,
}: {
  item: DeskTimelineItem;
  day: DeskDay;
  onChanged: () => void;
}) {
  const { booking, event } = item;
  const phase = (booking ?? event).phase;
  const participants = event?.participants.filter((person) => person.status !== 'CANCELLED') ?? [];
  const waiting = participants.filter((person) => person.status === 'BOOKED').length;
  const kind = booking
    ? booking.sparring
      ? 'Спарринг'
      : booking.withRobot
        ? 'Аренда с роботом'
        : 'Аренда'
    : event.kind === 'TRAINING'
      ? 'Тренировка'
      : 'Турнир';

  return (
    <li className="p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[0.75rem] text-text-subtle">
        <span>{kind}</span>
        <span
          className={cn(
            'rounded-full px-2 py-1',
            phase === 'ONGOING' ? 'bg-surface-accent-soft text-text-accent' : 'bg-surface-sunken',
          )}
        >
          {booking && booking.status !== 'BOOKED'
            ? markLabel(booking.status, booking.chargePercent, booking.bySubscription)
            : PHASE_LABELS[phase]}
        </span>
      </div>
      <p className="font-display text-[1rem] tabular-nums">
        {clockIn(item.startsAt, day.timezone)} — {clockIn(item.endsAt, day.timezone)}
      </p>
      {booking ? (
        <>
          <p className="mt-2 text-[0.9375rem] font-medium">
            <PersonLink userId={booking.client.userId}>{booking.client.fullName}</PersonLink>
          </p>
          <p className="mt-1 text-[0.8125rem] text-text-muted">
            {booking.tableLabel}
            {booking.coachName ? ` · тренер ${booking.coachName}` : ''}
          </p>
          <a
            href={`tel:${booking.client.phone}`}
            className="mt-1 inline-flex min-h-11 items-center text-[0.875rem] text-text-accent"
          >
            {booking.client.phone}
          </a>
          {booking.status === 'BOOKED' && phase !== 'UPCOMING' && (
            <MarkButtons
              kind="TABLE"
              entryId={booking.id}
              noShowPercent={day.policy.noShowChargePercent}
              bySubscription={booking.bySubscription}
              onDone={onChanged}
            />
          )}
        </>
      ) : (
        <details className="mt-2">
          <summary className="min-h-11 cursor-pointer py-2 text-[0.9375rem] font-medium">
            {event.title}
            <span className="mt-1 block text-[0.8125rem] font-normal text-text-muted">
              Участников: {participants.length}
              {phase !== 'UPCOMING' && waiting > 0 ? ` · ждут отметки: ${waiting}` : ''}
            </span>
          </summary>
          {event.coachName && (
            <p className="mb-2 text-[0.8125rem] text-text-muted">Тренер: {event.coachName}</p>
          )}
          {item.unplaced && (
            <p className="mb-2 text-[0.8125rem] text-text-subtle">
              Зал мероприятия не указан: показано по клубу.
            </p>
          )}
          {participants.length === 0 ? (
            <p className="py-2 text-[0.875rem] text-text-muted">Пока никто не записался.</p>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {participants.map((person) => (
                <li key={person.entryId} className="py-3">
                  <p className="text-[0.875rem]">
                    <PersonLink userId={person.userId}>{person.fullName}</PersonLink>
                  </p>
                  <a
                    href={`tel:${person.phone}`}
                    className="inline-flex min-h-11 items-center text-[0.8125rem] text-text-accent"
                  >
                    {person.phone}
                  </a>
                  {person.status === 'BOOKED' && phase !== 'UPCOMING' ? (
                    <MarkButtons
                      kind={event.kind}
                      entryId={person.entryId}
                      noShowPercent={day.policy.noShowChargePercent}
                      bySubscription={person.bySubscription}
                      onDone={onChanged}
                    />
                  ) : (
                    <p className="text-[0.8125rem] text-text-muted">
                      {person.status === 'BOOKED'
                        ? 'Записан'
                        : markLabel(person.status, person.chargePercent, person.bySubscription)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </li>
  );
}
