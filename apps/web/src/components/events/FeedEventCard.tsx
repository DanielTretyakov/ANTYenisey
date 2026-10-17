'use client';

import type { FeedEvent } from '@yenisey/types';
import { KindBadge } from '@/components/club/EventRow';
import { CARD_COVER } from '@/components/ui/CardRow';
import { clubAccent } from '@/lib/clubTheme';
import { formatKopecks } from '@/lib/money';
import { dateIn, timeIn, viewerTime, viewerZone } from '@/lib/zonedTime';

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
      <span className={KICKER}>{dayLabel(event.startsAt, event.timezone)}</span>
      <span className="mt-1.5 font-display text-[1.375rem] text-text">{timeLabel(event.startsAt, event.timezone)}</span>
      <ViewerTime startsAt={event.startsAt} endsAt={null} timezone={event.timezone} />
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

/**
 * То же мероприятие высокой карточкой 9:16 — «Ближайшее в моих клубах» на
 * стартовой (решение владельца от 17.10.2026: в стиле вкладок страницы
 * клуба). Обложка — в цвете клуба мероприятия: у ленты клубы разные, и
 * `clubAccent` ставится на саму карточку. На обложке — вид, день и время
 * крупно, ниже — название, ведущий, клуб и цена. Щелчок — окно с записью.
 */
export function FeedEventTall({ event, onOpen }: { event: FeedEvent; onOpen: (event: FeedEvent) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(event)}
      style={clubAccent(event.club.accentColor)}
      className="group flex aspect-[9/16] w-full flex-col overflow-hidden rounded-card border border-border bg-surface-raised text-left transition-colors hover:border-border-strong"
    >
      <span className="flex h-[42%] w-full shrink-0 flex-col justify-between p-4" style={{ background: CARD_COVER }}>
        <KindBadge kind={event.kind} />
        <span className="block text-white">
          <span className="block text-[0.8125rem] text-white/75">{dayLabel(event.startsAt, event.timezone)}</span>
          <span className="mt-0.5 block font-display text-[1.75rem] leading-none">{timeLabel(event.startsAt, event.timezone)}</span>
          <ViewerTime
            startsAt={event.startsAt}
            endsAt={null}
            timezone={event.timezone}
            className="mt-1 block text-[0.75rem] text-white/70"
          />
        </span>
      </span>

      <span className="flex min-h-0 w-full flex-1 flex-col p-4">
        <span className="font-display text-[1.0625rem] leading-tight text-text [text-wrap:balance] group-hover:underline">
          {event.title}
        </span>
        {event.subtitle && <span className="mt-1.5 text-[0.8125rem] text-text-muted">{event.subtitle}</span>}
        <span className="mt-1 text-[0.8125rem] text-text-muted">{event.club.name}</span>

        <span className="mt-auto flex items-end justify-between gap-2 pt-4">
          <span className="font-display text-[1.0625rem] text-text">{formatKopecks(event.price)}</span>
          <span className="text-[0.875rem] text-text-accent">Записаться →</span>
        </span>
      </span>
    </button>
  );
}

/** «Пятница, 2 октября» — по часам зала (`timezone`), без него — браузера. */
export function dayLabel(instant: string, timezone?: string): string {
  const label = dateIn(instant, timezone ?? viewerZone(), { weekday: 'long', day: 'numeric', month: 'long' });

  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** «18:00» — по часам зала (`timezone`), без него — браузера. */
export function timeLabel(instant: string, timezone?: string): string {
  return timeIn(instant, timezone ?? viewerZone());
}

/**
 * «у вас 14:00» под временем зала — только если часы смотрящего другие
 * (решение от 05.10.2026). Одна на карточки, окно мероприятия и стартовую.
 */
export function ViewerTime({
  startsAt,
  endsAt,
  timezone,
  className,
}: {
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  className?: string;
}) {
  const hint = viewerTime(startsAt, endsAt, timezone);

  return hint ? <span className={className ?? 'mt-0.5 block text-[0.8125rem] text-text-muted'}>{hint}</span> : null;
}
