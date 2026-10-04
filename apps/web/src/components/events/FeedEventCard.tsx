'use client';

import type { FeedEvent } from '@yenisey/types';
import { KindBadge } from '@/components/club/EventRow';
import { formatKopecks } from '@/lib/money';

const KICKER = 'text-[0.75rem] font-semibold tracking-[0.1em] text-text-subtle uppercase';

/**
 * Карточка ближайшего мероприятия: день, время крупно, вид и название, клуб.
 * Одна на «Ближайшее в моих клубах» стартовой и «Ближайшие занятия» на
 * странице тренера — щелчок открывает окно мероприятия с записью.
 */
export function FeedEventCard({ event, onOpen }: { event: FeedEvent; onOpen: (event: FeedEvent) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(event)}
      className="group flex h-full w-full flex-col rounded-card border border-border bg-surface-raised px-5 py-4 text-left transition-colors hover:border-border-strong"
    >
      <span className={KICKER}>{dayLabel(event.startsAt)}</span>
      <span className="mt-1.5 font-display text-[1.375rem] text-text">{timeLabel(event.startsAt)}</span>
      <span className="mt-1 flex flex-wrap items-center gap-2">
        <KindBadge kind={event.kind} />
        <span className="text-[0.9375rem] text-text group-hover:underline">{event.title}</span>
      </span>
      <span className="mt-1 text-[0.8125rem] text-text-muted">
        {event.club.name}
        {event.subtitle && ` · ${event.subtitle}`} · {formatKopecks(event.price)}
      </span>
    </button>
  );
}

/** «Пятница, 2 октября». */
export function dayLabel(instant: string): string {
  const label = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(instant),
  );

  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** «18:00». */
export function timeLabel(instant: string): string {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(instant));
}
