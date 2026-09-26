'use client';

import Link from 'next/link';
import type { ClubEvent, EventKind } from '@yenisey/types';
import { WhenSpan } from '@/components/club/When';
import { Button } from '@/components/ui/Button';
import { seatsLabel, useEventAction, type EventViewer } from '@/lib/eventViewer';
import { formatKopecks } from '@/lib/money';
import { loginHref } from '@/lib/next';
import { tintFill, tintMark } from '@/lib/personColor';

/**
 * Цвет вида мероприятия — те же краски, что у кистей расписания: занятие —
 * фирменный изумруд, турнир — розовый. Календарь месяца и чипы фильтра
 * различают вид цветом, и администратор видит у себя в сетке то же самое.
 */
export const KIND_PAINT: Record<EventKind, string> = {
  TRAINING: 'var(--brand-600)',
  TOURNAMENT: 'var(--hue-rose)',
};

export const KIND_LABEL: Record<EventKind, string> = {
  TRAINING: 'Тренировка',
  TOURNAMENT: 'Турнир',
};

/** Плашка вида: «Тренировка» / «Турнир» в цвете вида. */
export function KindBadge({ kind }: { kind: EventKind }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 self-start rounded-full px-2 py-0.5 text-[0.75rem] text-text"
      style={{ background: tintFill(KIND_PAINT[kind]) }}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: tintMark(KIND_PAINT[kind]) }} />
      {KIND_LABEL[kind]}
    </span>
  );
}

/**
 * Строка мероприятия в «Предстоящих»: когда, что, цена и места, кнопка
 * записи. Название открывает окно мероприятия.
 */
export function EventRow({
  slug,
  event,
  viewer,
  forPerson,
  onChanged,
  onOpen,
}: {
  slug: string;
  event: ClubEvent;
  viewer: EventViewer;
  forPerson: string | null;
  onChanged: () => void;
  onOpen: () => void;
}) {
  const { toggle, pending, error } = useEventAction(slug, forPerson, onChanged);

  // Мест нет — но записанному кнопка отмены нужна и на переполненном занятии.
  const full = event.freeSeats === 0 && !event.registered;

  return (
    <div className="border-b border-border py-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {/* У занятия известно окончание, у турнира нет: WhenSpan сам сводится к
            одной строке времени, когда конца не задано. */}
        <WhenSpan startsAt={event.startsAt} endsAt={event.endsAt} />

        <span className="min-w-0 grow">
          {/* Название открывает окно мероприятия: там описание, зал и кто
              записан. Кнопкой, а не ссылкой — адреса у окна нет. */}
          <button
            type="button"
            onClick={onOpen}
            className="block text-left text-[1rem] text-text underline-offset-2 hover:underline"
          >
            {event.title}
            {/* Ограничение по рейтингу дописывается, только если его нет в самом
                названии: типы «Енисея» называются «Клуб 100», и приписка давала
                бы «Клуб 100 рейтинг до 100». */}
            {event.ratingLabel && !event.title.includes(event.ratingLabel) && (
              <span className="ml-2 text-[0.8125rem] text-text-subtle">рейтинг до {event.ratingLabel}</span>
            )}
          </button>

          {event.subtitle && <span className="mt-0.5 block text-[0.8125rem] text-text-muted">{event.subtitle}</span>}

          <span className="mt-0.5 block text-[0.8125rem] text-text-muted">
            {/* Подсказка, чем будет оплачена запись: абонементом — вместо цены.
                Обещанием это не считается: выбор делается в момент записи. */}
            {event.payWith && !event.registered
              ? `${formatKopecks(event.price)} — абонементом «${event.payWith.planName}»`
              : formatKopecks(event.price)}{' '}
            · {seatsLabel(event)}
            {event.registeredCount > 0 && (
              <>
                {' · '}
                {/* Состав — в окне, а не списком в строке: десяток фамилий в
                    каждой строке превратил бы расписание в простыню. */}
                <button type="button" className="underline underline-offset-2 hover:text-text" onClick={onOpen}>
                  кто записан
                </button>
              </>
            )}
          </span>

          {error && (
            <span className="mt-1.5 block text-[0.8125rem] text-danger" role="alert">
              {error}
            </span>
          )}
        </span>

        {(viewer === 'client' || viewer === 'staff') && (
          <Button
            variant={event.registered ? 'secondary' : 'primary'}
            size="sm"
            pending={pending}
            disabled={full}
            onClick={() => void toggle(event)}
          >
            {event.registered ? 'Отменить запись' : full ? 'Мест нет' : 'Записаться'}
          </Button>
        )}

        {viewer === 'anonymous' && (
          <Link href={loginHref()}>
            <Button variant="secondary" size="sm">
              Войти и записаться
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="border-t border-border" aria-busy="true">
      {[0, 1].map((row) => (
        <div key={row} className="flex items-center gap-5 border-b border-border py-5">
          <span className="h-3.5 w-36 shrink-0 rounded-full bg-border/50" />
          <span className="h-3.5 w-56 rounded-full bg-border/40" />
        </div>
      ))}
    </div>
  );
}

/** «чт 26 сентября, 18:00» — по часам браузера, как вся страница. */
export function shortWhen(instant: string): string {
  const value = new Date(instant);
  const day = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' }).format(value);
  const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(value);

  return `${day}, ${time}`;
}
