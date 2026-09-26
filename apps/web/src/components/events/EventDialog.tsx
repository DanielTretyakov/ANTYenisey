'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { EventDetail, EventKind, EventParticipant } from '@yenisey/types';
import { PlayerAvatar } from '@/components/player/PlayerView';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { ApiError, clubApi } from '@/lib/api';
import { eventViewerOf, seatsLabel, useEventAction } from '@/lib/eventViewer';
import { formatKopecks } from '@/lib/money';
import { loginHref } from '@/lib/next';
import { useSession } from '@/lib/useSession';

/**
 * Окно мероприятия: когда, где, почём, о чём и кто уже записан.
 *
 * Одно на стартовую, страницу клуба и сетку брони — в каждом из этих мест
 * человек спрашивает одно и то же. Подробности приходят отдельным запросом
 * (`GET clubs/:slug/events/:kind/:id`): в строке списка их нет, и таскать
 * описание и аватары всех записавшихся в каждой строке значило бы платить за
 * окно, которое откроют у одного.
 *
 * Кнопка записи — та же, что в строке списка (`useEventAction`): правило,
 * кому её показывать, одно, и окно со стартовой не должно обещать
 * сотруднику клуба запись, которую сервер отклонит.
 */
export function EventDialog({
  slug,
  kind,
  id,
  forPerson = null,
  selfIsChild = false,
  onClose,
  onChanged,
}: {
  slug: string;
  kind: EventKind;
  id: string;
  /** Выбранный ребёнок: запись и отметка «записан» — его. */
  forPerson?: string | null;
  /** Вошедшему нет 14, и он смотрит сам: записать себя он не может. */
  selfIsChild?: boolean;
  onClose: () => void;
  /** Запись или отмена прошла — списку под окном пора обновиться. */
  onChanged?: () => void;
}) {
  const session = useSession();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    clubApi(slug)
      .event(kind, id, forPerson)
      .then(setEvent)
      .catch((cause: unknown) =>
        setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен'),
      );
  }, [slug, kind, id, forPerson]);

  useEffect(load, [load]);

  const changed = useCallback(() => {
    load();
    onChanged?.();
  }, [load, onChanged]);

  const action = useEventAction(slug, forPerson, changed);
  const viewer = eventViewerOf(session, slug, forPerson, selfIsChild);

  return (
    <Dialog
      size="lg"
      onClose={onClose}
      title={event ? <EventTitle event={event} /> : kind === 'TRAINING' ? 'Занятие' : 'Турнир'}
      description={
        event && (
          <>
            {kind === 'TRAINING' ? 'Занятие' : 'Турнир'} ·{' '}
            <Link href={`/clubs/${event.club.slug}`} className="text-text-accent underline-offset-2 hover:underline">
              {event.club.name}
            </Link>
          </>
        )
      }
    >
      <div className="grid gap-6 px-6 py-5">
        {error && <Alert>{error}</Alert>}

        {!event && !error && <DetailSkeleton />}

        {event && (
          <>
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Fact label="Когда">
                <span className="block first-letter:uppercase">{dayOf(event.startsAt)}</span>
                <span className="block font-display text-[1.0625rem]">
                  {timeOf(event.startsAt)}
                  <span className="text-text-subtle"> – </span>
                  {timeOf(event.endsAt)}
                </span>
              </Fact>

              <Fact label="Где">
                {event.place ? (
                  <>
                    <span className="block">{event.place.hallName}</span>
                    <span className="block text-[0.875rem] text-text-muted">{placeLine(event.place)}</span>
                    {event.place.phone && (
                      <a
                        href={`tel:${event.place.phone}`}
                        className="mt-0.5 block text-[0.875rem] text-text-accent underline-offset-2 hover:underline"
                      >
                        {event.place.phone}
                      </a>
                    )}
                  </>
                ) : (
                  <span className="text-text-muted">Зал не указан — уточните в клубе</span>
                )}
              </Fact>

              <Fact label="Стоимость">
                <span className="block font-display text-[1.0625rem]">{formatKopecks(event.price)}</span>
                {event.payWith && !event.registered && (
                  <span className="block text-[0.875rem] text-text-muted">
                    спишется визит абонемента «{event.payWith.planName}»
                  </span>
                )}
              </Fact>

              {event.coach && (
                <Fact label="Тренер">
                  <Link
                    href={`/coaches/${event.coach.id}`}
                    className="text-text-accent underline-offset-2 hover:underline"
                  >
                    {event.coach.name}
                  </Link>
                </Fact>
              )}
            </dl>

            {event.description && (
              <p className="text-[0.9375rem] leading-relaxed whitespace-pre-line text-text">
                {event.description}
              </p>
            )}

            <section>
              <h3 className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-[0.9375rem]">
                Кто записан
                <span className="text-[0.875rem] font-normal text-text-muted">{seatsLabel(event)}</span>
              </h3>

              {event.people.length === 0 ? (
                <p className="text-[0.875rem] text-text-muted">Станьте первым.</p>
              ) : (
                <ul className="flex flex-wrap gap-x-2 gap-y-3">
                  {event.people.map((person, index) => (
                    <li key={person.userId ?? `child-${index}`}>
                      <Person person={person} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <EventActions
              event={event}
              viewer={viewer}
              pending={action.pending}
              error={action.error}
              onToggle={() => void action.toggle(event)}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}

function EventTitle({ event }: { event: EventDetail }) {
  return (
    <>
      {event.title}
      {/* Ограничение по рейтингу — только если его нет в самом названии:
          «Клуб 100 рейтинг до 100» читается как опечатка. */}
      {event.ratingLabel && !event.title.includes(event.ratingLabel) && (
        <span className="ml-2 text-[0.875rem] font-normal text-text-subtle">
          рейтинг до {event.ratingLabel}
        </span>
      )}
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="mb-1 text-[0.75rem] tracking-[0.06em] text-text-subtle uppercase">{label}</dt>
      <dd className="text-[0.9375rem] text-text">{children}</dd>
    </div>
  );
}

/**
 * Записавшийся кружком. Со ссылкой на профиль — только взрослый: у игрока
 * младше 14 сервер не отдаёт ни идентификатора, ни фотографии, и кружок
 * остаётся инициалами без перехода.
 */
function Person({ person }: { person: EventParticipant }) {
  const body = (
    <>
      <PlayerAvatar fileId={person.avatarFileId} name={person.name} gender={person.gender} size="xs" />
      <span className="mt-1 block w-20 truncate text-center text-[0.75rem] text-text-muted group-hover:text-text">
        {person.name}
      </span>
    </>
  );

  if (!person.userId) {
    return (
      <span className="flex w-20 flex-col items-center" title={person.name}>
        {body}
      </span>
    );
  }

  return (
    <Link
      href={`/players/${person.userId}`}
      title={person.name}
      className="group flex w-20 flex-col items-center rounded-control py-1 hover:bg-surface-sunken"
    >
      {body}
    </Link>
  );
}

function EventActions({
  event,
  viewer,
  pending,
  error,
  onToggle,
}: {
  event: EventDetail;
  viewer: ReturnType<typeof eventViewerOf>;
  pending: boolean;
  error: string | null;
  onToggle: () => void;
}) {
  const started = new Date(event.startsAt).getTime() <= Date.now();
  // Мест нет — но записанному кнопка отмены нужна и на переполненном занятии.
  const full = event.freeSeats === 0 && !event.registered;

  if (started) {
    return (
      <p className="text-[0.875rem] text-text-muted">
        {event.registered ? 'Вы записаны. ' : ''}Мероприятие уже началось — запись закрыта.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
      {(viewer === 'client' || viewer === 'staff') && (
        <Button
          variant={event.registered ? 'secondary' : 'primary'}
          pending={pending}
          disabled={full}
          onClick={onToggle}
        >
          {event.registered ? 'Отменить запись' : full ? 'Мест нет' : 'Записаться'}
        </Button>
      )}

      {viewer === 'anonymous' && (
        <Link href={loginHref()}>
          <Button>Войти и записаться</Button>
        </Link>
      )}

      {viewer === 'staff' && !event.registered && (
        <p className="text-[0.8125rem] text-text-subtle">
          Сотрудники записываются как все — кроме администратора в день его смены.
        </p>
      )}

      {viewer === 'child' && (
        <p className="text-[0.875rem] text-text-muted">
          До 14 лет на мероприятия записывает родитель — или администратор клуба у стойки.
        </p>
      )}

      {event.registered && (viewer === 'client' || viewer === 'staff') && (
        <span className="text-[0.875rem] text-text-muted">Вы записаны</span>
      )}

      {error && (
        <p className="w-full text-[0.875rem] text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <span className="h-3.5 w-48 rounded-full bg-border/50" />
      <span className="h-3.5 w-64 rounded-full bg-border/40" />
      <span className="h-3.5 w-40 rounded-full bg-border/40" />
    </div>
  );
}

/**
 * «четверг, 26 сентября». По часам браузера, как и строка списка (см. `When`):
 * человеку важно, во сколько выходить ЕМУ.
 */
function dayOf(instant: string): string {
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(instant),
  );
}

function timeOf(instant: string): string {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(instant));
}

/**
 * Город и адрес одной строкой. Город приписывается, только если его нет в
 * адресе: «Красноярск, Красноярск, ул. …» читается как ошибка вёрстки.
 */
function placeLine(place: NonNullable<EventDetail['place']>): string {
  if (!place.address) return place.city ?? 'Адрес не указан';

  const repeats = place.city !== null && place.address.toLowerCase().includes(place.city.toLowerCase());

  return repeats || !place.city ? place.address : `${place.city}, ${place.address}`;
}
