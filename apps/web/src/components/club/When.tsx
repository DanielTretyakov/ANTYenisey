import { cn } from '@/lib/cn';
import { dateIn, timeIn, viewerTime, viewerZone } from '@/lib/zonedTime';

/**
 * Когда мероприятие: дата строкой, время под ней.
 *
 * Две строки намеренно, а не одна с переносом. «10 сентября, 11:00» в узкой
 * колонке ломается по запятой, и список получает рваный левый край; здесь
 * перенос задан, а не случается. Время отдельной строкой к тому же и есть то,
 * что в расписании ищут глазами.
 *
 * Момент показывается по часам ЗАЛА (`timezone`), а если у смотрящего пояс
 * другой — ещё строкой «у вас 14:00» (решение владельца от 05.10.2026). Раньше
 * время шло по часам браузера, и человек из Москвы видел красноярскую
 * тренировку в 14:00, а в сетке, на афише и в сообщении MAX она стояла в 18:00.
 * Без `timezone` — по часам браузера, как прежде.
 */
export function When({ instant, timezone, className }: { instant: string; timezone?: string; className?: string }) {
  const zone = timezone ?? viewerZone();
  const hint = timezone ? viewerTime(instant, null, timezone) : null;

  return (
    <span className={cn('block w-32 shrink-0', className)}>
      <time dateTime={instant} className="block font-display text-[0.9375rem] text-text">
        {dateIn(instant, zone, { day: 'numeric', month: 'long' })}
      </time>
      <span className="mt-0.5 block font-display text-[1.0625rem] text-text">{timeIn(instant, zone)}</span>
      {hint && <span className="mt-0.5 block text-[0.75rem] text-text-muted">{hint}</span>}
    </span>
  );
}

/** «27 августа, 19:00 – 20:30» для аренды: у неё, в отличие от турнира, есть конец. */
export function WhenSpan({
  startsAt,
  endsAt,
  timezone,
  className,
}: {
  startsAt: string;
  endsAt: string | null;
  /** Пояс зала; без него — часы браузера. */
  timezone?: string;
  className?: string;
}) {
  if (!endsAt) {
    return <When instant={startsAt} timezone={timezone} className={className} />;
  }

  const zone = timezone ?? viewerZone();
  const start = startsAt;
  const end = endsAt;
  const date = dateIn(start, zone, { day: 'numeric', month: 'long' });
  const time = (value: string): string => timeIn(value, zone);
  const hint = timezone ? viewerTime(startsAt, endsAt, timezone) : null;

  return (
    <span className={cn('block w-32 shrink-0', className)}>
      <time dateTime={startsAt} className="block font-display text-[0.9375rem] text-text">
        {date}
      </time>
      <span className="mt-0.5 block font-display text-[1.0625rem] whitespace-nowrap text-text">
        {time(start)}
        <span className="text-text-subtle"> – </span>
        {time(end)}
      </span>
      {hint && <span className="mt-0.5 block text-[0.75rem] whitespace-nowrap text-text-muted">{hint}</span>}
    </span>
  );
}
