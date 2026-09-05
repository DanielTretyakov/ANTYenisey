import { cn } from '@/lib/cn';

/**
 * Когда мероприятие: дата строкой, время под ней.
 *
 * Две строки намеренно, а не одна с переносом. «10 сентября, 11:00» в узкой
 * колонке ломается по запятой, и список получает рваный левый край; здесь
 * перенос задан, а не случается. Время отдельной строкой к тому же и есть то,
 * что в расписании ищут глазами.
 *
 * Момент показывается по часам браузера. Пояс зала сюда не передаётся
 * сознательно: человек в Красноярске, смотрящий на турнир в Абакане, должен
 * увидеть, во сколько ЕМУ выходить, а разница поясов между залами одной
 * платформы — забота страницы зала, а не строки списка.
 */
export function When({ instant, className }: { instant: string; className?: string }) {
  const value = new Date(instant);

  const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(value);
  const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(
    value,
  );

  return (
    <span className={cn('block w-32 shrink-0', className)}>
      <time dateTime={instant} className="block font-display text-[0.9375rem] text-text">
        {date}
      </time>
      <span className="mt-0.5 block font-display text-[1.0625rem] text-text">{time}</span>
    </span>
  );
}

/** «27 августа, 19:00 – 20:30» для аренды: у неё, в отличие от турнира, есть конец. */
export function WhenSpan({
  startsAt,
  endsAt,
  className,
}: {
  startsAt: string;
  endsAt: string | null;
  className?: string;
}) {
  if (!endsAt) {
    return <When instant={startsAt} className={className} />;
  }

  const start = new Date(startsAt);
  const end = new Date(endsAt);

  const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(start);
  const time = (value: Date): string =>
    new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(value);

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
    </span>
  );
}
