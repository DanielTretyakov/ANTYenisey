'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { BookingEntry, ClubEvent, PublicTenant } from '@yenisey/types';
import { ClubMark } from '@/components/club/ClubMark';
import { When, WhenSpan } from '@/components/club/When';
import { ClubNav } from '@/components/layout/ClubNav';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { api, ApiError } from '@/lib/api';
import { clubAccent } from '@/lib/clubTheme';
import { cn } from '@/lib/cn';
import { formatKopecks } from '@/lib/money';
import { roleInClub } from '@/lib/membership';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { useSession } from '@/lib/useSession';

/** Кем человек приходится этому клубу — с точки зрения кнопки «Записаться». */
type Viewer = 'anonymous' | 'client' | 'staff';

/**
 * Страница клуба.
 *
 * Порядок блоков задан ТЗ и не косметический: сначала «Мои мероприятия», потом
 * «Предстоящие». На страницу клуба заходят чаще всего чтобы посмотреть, куда
 * уже записан и когда идти, а не чтобы выбрать новое.
 *
 * Оформление берётся у клуба: `clubAccent` подменяет акцентные переменные на
 * обёртке страницы, и все компоненты внутри перекрашиваются сами — они
 * называют роль («цвет действия»), а не краску. Клуб без своего цвета
 * остаётся в изумруде платформы.
 */
export default function ClubPage() {
  const slug = useClubSlug();
  const club = useClubApi();
  const session = useSession();

  const [tenant, setTenant] = useState<PublicTenant | null>(null);
  const [events, setEvents] = useState<ClubEvent[] | null>(null);
  const [mine, setMine] = useState<BookingEntry[] | null>(null);
  const [favourite, setFavourite] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .tenant(slug)
      .then(setTenant)
      .catch((cause: unknown) =>
        setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен'),
      );
  }, [slug]);

  const loadEvents = useCallback(() => {
    club
      .events()
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [club]);

  useEffect(loadEvents, [loadEvents]);

  // Мои мероприятия и отметка «мой клуб» — только для вошедших. Аноним видит
  // открытый список: клуб выбирают до того, как заводят учётку.
  useEffect(() => {
    if (session.status !== 'ready') {
      setMine(null);
      setFavourite(null);
      return;
    }

    club
      .myEvents()
      .then(setMine)
      .catch(() => setMine([]));

    api
      .myClubs()
      .then((clubs) => setFavourite(clubs.some((item) => item.slug === slug)))
      .catch(() => setFavourite(null));
  }, [session.status, club, slug]);

  /**
   * Кто смотрит на страницу.
   *
   * `staff` — сотрудник ЭТОГО клуба: администратор, владелец или тренер.
   * Записаться на турнир он не может, и кнопку ему показывать нельзя — она
   * упрётся в «Недостаточно прав» уже после нажатия. Та же причина, по которой
   * в навигации от сотрудника скрыта бронь стола: запись ссылается на
   * карточку клиента, а его роль в этом клубе другая.
   *
   * Человек без привязки к клубу проходит как клиент: записаться может любой
   * пользователь платформы, вступать заранее не нужно.
   */
  const viewer: Viewer =
    session.status !== 'ready'
      ? 'anonymous'
      : (roleInClub(session.user, slug) ?? 'CLIENT') === 'CLIENT'
        ? 'client'
        : 'staff';

  return (
    <div className="flex min-h-dvh flex-col bg-surface" style={clubAccent(tenant?.accentColor)}>
      <SiteHeader clubNav={<ClubNav slug={slug} />} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-20 sm:px-8">
        <Masthead tenant={tenant} />

        {error && <Alert>{error}</Alert>}

        {session.status === 'ready' && (
          <FavouriteButton slug={slug} favourite={favourite} onChange={setFavourite} />
        )}

        <MyEvents entries={mine} anonymous={session.status === 'anonymous'} />

        <Upcoming
          events={events}
          viewer={viewer}
          onChanged={() => {
            loadEvents();
            club.myEvents().then(setMine).catch(() => undefined);
          }}
        />
      </main>
    </div>
  );
}

/**
 * Шапка клуба: знак, название, города.
 *
 * Ширина и высота заданы до ответа сервера — иначе содержимое страницы
 * подпрыгивало бы, когда приедет название.
 */
function Masthead({ tenant }: { tenant: PublicTenant | null }) {
  const places = tenant ? [tenant.city, ...tenant.otherCities].filter(Boolean).join(', ') : '';

  return (
    <header className="flex items-center gap-5 py-12 sm:py-16">
      {tenant ? (
        <ClubMark club={tenant} size="lg" />
      ) : (
        <span className="h-16 w-16 shrink-0 rounded-control bg-border/50" aria-hidden="true" />
      )}

      <div className="min-w-0">
        {tenant ? (
          <>
            <h1 className="text-[1.75rem] leading-tight sm:text-[2.25rem]">{tenant.name}</h1>
            {places && <p className="mt-1.5 text-[0.9375rem] text-text-muted">{places}</p>}
          </>
        ) : (
          <>
            <span className="block h-7 w-64 rounded-full bg-border/50" />
            <span className="mt-3 block h-3 w-32 rounded-full bg-border/40" />
          </>
        )}
      </div>
    </header>
  );
}

/**
 * Отметка «мой клуб».
 *
 * Избранное и заявленная принадлежность — одна кнопка, а не две: разделять их
 * значило бы объяснять человеку разницу, которой в его голове нет.
 */
function FavouriteButton({
  slug,
  favourite,
  onChange,
}: {
  slug: string;
  favourite: boolean | null;
  onChange: (value: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(): Promise<void> {
    setPending(true);
    setError(null);

    try {
      const clubs = favourite ? await api.removeClub(slug) : await api.addClub(slug);
      onChange(clubs.some((item) => item.slug === slug));
    } catch (cause) {
      // Отказ «клубов уже три» приходит сюда текстом от сервера: предел живёт
      // в базе, и повторять его здесь числом значило бы завести второе место,
      // где он записан.
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mb-12">
      <Button
        variant={favourite ? 'secondary' : 'primary'}
        pending={pending}
        onClick={() => void toggle()}
      >
        {favourite ? 'Мой клуб' : 'Отметить своим'}
      </Button>

      {error && (
        <p className="mt-2.5 max-w-md text-[0.875rem] text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Мои мероприятия в этом клубе: записи на турниры и свои брони столов. */
function MyEvents({ entries, anonymous }: { entries: BookingEntry[] | null; anonymous: boolean }) {
  if (anonymous) {
    return null;
  }

  const upcoming = (entries ?? []).filter(
    (entry) => entry.status === 'BOOKED' && new Date(entry.startsAt).getTime() > Date.now(),
  );

  if (entries !== null && upcoming.length === 0) {
    return null;
  }

  return (
    <section className="mb-16">
      <SectionTitle>Мои мероприятия</SectionTitle>

      {entries === null ? (
        <RowSkeleton />
      ) : (
        <ul className="border-t border-border">
          {upcoming.map((entry) => (
            <li
              key={`${entry.kind}-${entry.id}`}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border py-4"
            >
              <WhenSpan startsAt={entry.startsAt} endsAt={entry.endsAt} />

              <span className="min-w-0 grow">
                <span className="block text-[0.9375rem] text-text">{entry.title}</span>
                {entry.subtitle && (
                  <span className="block text-[0.8125rem] text-text-muted">{entry.subtitle}</span>
                )}
              </span>

              <span className="text-[0.875rem] whitespace-nowrap text-text-muted">
                {formatKopecks(entry.price)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[0.8125rem] text-text-subtle">
        Отменить запись и увидеть прошедшие можно в разделе{' '}
        <Link href="/my-bookings" className="text-text-accent underline-offset-2 hover:underline">
          «Мои записи»
        </Link>
        .
      </p>
    </section>
  );
}

/** Открытая запись клуба. Аренды столов здесь нет: к чужой броне не присоединиться. */
function Upcoming({
  events,
  viewer,
  onChanged,
}: {
  events: ClubEvent[] | null;
  viewer: Viewer;
  onChanged: () => void;
}) {
  return (
    <section>
      <SectionTitle>Предстоящие мероприятия</SectionTitle>

      {events === null && <RowSkeleton />}

      {events?.length === 0 && (
        <p className="border-t border-border py-8 text-[0.9375rem] text-text-muted">
          Клуб пока не объявил ни одного турнира.
        </p>
      )}

      {viewer === 'staff' && events && events.length > 0 && (
        <p className="mb-4 text-[0.8125rem] text-text-subtle">
          Вы сотрудник этого клуба: записаться на его турнир нельзя. Список
          записавшихся и проведение турнира — в разделе «Занятия и турниры».
        </p>
      )}

      {events && events.length > 0 && (
        <ul className="border-t border-border">
          {events.map((event) => (
            <li key={event.id}>
              <EventRow event={event} viewer={viewer} onChanged={onChanged} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EventRow({
  event,
  viewer,
  onChanged,
}: {
  event: ClubEvent;
  viewer: Viewer;
  onChanged: () => void;
}) {
  const club = useClubApi();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(): Promise<void> {
    setPending(true);
    setError(null);

    try {
      if (event.registered) {
        await club.cancelTournamentRegistration(event.id);
      } else {
        await club.registerForTournament(event.id);
      }

      onChanged();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border py-5">
      <When instant={event.startsAt} />

      <span className="min-w-0 grow">
        <span className="block text-[1rem] text-text">
          {event.title}
          {/* Ограничение по рейтингу дописывается, только если его нет в самом
              названии: типы «Енисея» называются «Клуб 100», и приписка давала
              бы «Клуб 100 рейтинг до 100». */}
          {event.ratingLabel && !event.title.includes(event.ratingLabel) && (
            <span className="ml-2 text-[0.8125rem] text-text-subtle">
              рейтинг до {event.ratingLabel}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[0.8125rem] text-text-muted">
          {formatKopecks(event.price)} · {registeredLabel(event.registeredCount)}
        </span>

        {error && (
          <span className="mt-1.5 block text-[0.8125rem] text-danger" role="alert">
            {error}
          </span>
        )}
      </span>

      {viewer === 'client' && (
        <Button
          variant={event.registered ? 'secondary' : 'primary'}
          size="sm"
          pending={pending}
          onClick={() => void toggle()}
        >
          {event.registered ? 'Отменить запись' : 'Записаться'}
        </Button>
      )}

      {viewer === 'anonymous' && (
        <Link href="/login">
          <Button variant="secondary" size="sm">
            Войти и записаться
          </Button>
        </Link>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-5 text-[1.375rem]">{children}</h2>;
}

function RowSkeleton() {
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

/** «Записались: 8». Ноль показывается словом — «0 записавшихся» читается как ошибка. */
function registeredLabel(count: number): string {
  return count === 0 ? 'Пока никто не записался' : `Записались: ${count}`;
}
