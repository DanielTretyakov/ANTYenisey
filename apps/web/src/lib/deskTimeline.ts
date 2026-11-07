import type { DeskBooking, DeskDay, DeskEvent } from '@yenisey/types';

/** Хронология выбранного зала и дня. Фазы и статусы приходят с сервера. */
export type DeskTimelineItem =
  | {
      key: string;
      startsAt: string;
      endsAt: string;
      booking: DeskBooking;
      event?: never;
      unplaced?: never;
    }
  | {
      key: string;
      startsAt: string;
      endsAt: string;
      event: DeskEvent;
      booking?: never;
      unplaced: boolean;
    };

export function deskTimeline(day: Pick<DeskDay, 'bookings' | 'events' | 'unplaced'>): DeskTimelineItem[] {
  const items: DeskTimelineItem[] = day.bookings
    .filter((booking) => booking.status !== 'CANCELLED')
    .map((booking) => ({
      key: `TABLE:${booking.id}`,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      booking,
    }));

  // Один id допустим у тренировки и турнира: ключ включает вид мероприятия.
  const seen = new Set<string>();
  for (const [events, unplaced] of [
    [day.events, false],
    [day.unplaced, true],
  ] as const) {
    for (const event of events) {
      const key = `${event.kind}:${event.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        key,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        event,
        unplaced,
      });
    }
  }

  return items.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.key.localeCompare(b.key));
}
