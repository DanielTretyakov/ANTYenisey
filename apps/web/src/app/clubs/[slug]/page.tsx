'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { BookingEntry, ClubEvent, PublicTenant } from '@yenisey/types';
import { ClubMark } from '@/components/club/ClubMark';
import { EventDialog } from '@/components/events/EventDialog';
import { PersonSwitch } from '@/components/family/PersonSwitch';
import { WhenSpan } from '@/components/club/When';
import { ClubNav } from '@/components/layout/ClubNav';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { api, ApiError } from '@/lib/api';
import { clubAccent } from '@/lib/clubTheme';
import { eventViewerOf, seatsLabel, useEventAction, type EventViewer } from '@/lib/eventViewer';
import { cn } from '@/lib/cn';
import { formatKopecks } from '@/lib/money';
import { plural } from '@/lib/plural';
import { entryPriceLabel } from '@/lib/subscriptions';
import { loginHref } from '@/lib/next';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { usePersonSwitch } from '@/lib/usePersonSwitch';
import { useSession } from '@/lib/useSession';

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
  const family = usePersonSwitch();
  const forPerson = family.forPerson;

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

  // С выбранным ребёнком отметка «записан» в списке — его, а не родителя.
  const loadEvents = useCallback(() => {
    club
      .events(forPerson)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [club, forPerson]);

  useEffect(loadEvents, [loadEvents]);

  // После записи или отмены — и в строке, и в окне — обновляются оба списка:
  // «Мои мероприятия» и отметка «записан» в предстоящих.
  const refreshEvents = useCallback(() => {
    loadEvents();
    club.myEvents(forPerson).then(setMine).catch(() => undefined);
  }, [loadEvents, club, forPerson]);

  // Мои мероприятия и отметка «мой клуб» — только для вошедших. Аноним видит
  // открытый список: клуб выбирают до того, как заводят учётку.
  useEffect(() => {
    if (session.status !== 'ready') {
      setMine(null);
      setFavourite(null);
      return;
    }

    club
      .myEvents(forPerson)
      .then(setMine)
      .catch(() => setMine([]));

    api
      .myClubs()
      .then((clubs) => setFavourite(clubs.some((item) => item.slug === slug)))
      .catch(() => setFavourite(null));
  }, [session.status, club, slug, forPerson]);

  // Кто смотрит — одним правилом с окном мероприятия (`eventViewerOf`).
  const viewer = eventViewerOf(session, slug, forPerson, family.selfIsChild);

  return (
    <div className="flex min-h-dvh flex-col bg-surface" style={clubAccent(tenant?.accentColor)}>
      <SiteHeader clubNav={<ClubNav slug={slug} />} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-20 sm:px-8">
        <Masthead tenant={tenant} />

        {error && <Alert>{error}</Alert>}

        {session.status === 'ready' && (
          <FavouriteButton slug={slug} favourite={favourite} onChange={setFavourite} />
        )}

        <PersonSwitch
          people={family.children}
          selected={family.selected}
          onChoose={family.choose}
          className="-mt-6 mb-10"
        />

        <Halls tenant={tenant} slug={slug} viewer={viewer} />

        <MyEvents
          entries={mine}
          anonymous={session.status === 'anonymous'}
          whose={family.selected ? firstName(family.selected.fullName) : null}
          forPerson={forPerson}
          readOnly={family.selfIsChild}
        />

        <Upcoming
          slug={slug}
          events={events}
          viewer={viewer}
          forPerson={forPerson}
          selfIsChild={family.selfIsChild}
          onChanged={refreshEvents}
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
    // Перенос, а не сжатие: логотип клуба бывает шириной до 12rem, и на 360 px
    // название рядом с ним не помещалось даже в две строки: слово
    // «Енисей» в кавычках выходило за край экрана.
    <header className="flex flex-wrap items-center gap-x-5 gap-y-4 py-12 sm:py-16">
      {tenant ? (
        <ClubMark club={tenant} size="lg" />
      ) : (
        <span className="h-16 w-16 shrink-0 rounded-control bg-border/50" aria-hidden="true" />
      )}

      <div className="min-w-0">
        {tenant ? (
          <>
            <h1 className="text-[1.75rem] leading-tight [overflow-wrap:anywhere] sm:text-[2.25rem]">{tenant.name}</h1>
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
 * Залы клуба: где играют, почём стол и как связаться.
 *
 * До 21.09.2026 страница клуба состояла из одной ленты мероприятий, и человек,
 * нашедший зал в поиске, не мог узнать ни адреса, ни цены, ни телефона —
 * стартовая обещала «свободные столы», а на клубе их не было вовсе. Аренда при
 * этом существовала, но попасть в неё можно было только через пункт шапки,
 * который показывается уже состоявшемуся клиенту КЛУБА. Новичок такой роли не
 * имеет, и сценарий ТЗ «клиент бронирует сам» для него был закрыт.
 *
 * Отсюда две вещи на одном блоке: контакты и кнопка аренды, ведущая на ту же
 * сетку, что и пункт шапки. Сотруднику кнопка не показывается — бронь
 * ссылается на карточку клиента, которой у него нет; ему вместо неё показан
 * его же рабочий путь.
 */
function Halls({ tenant, slug, viewer }: { tenant: PublicTenant | null; slug: string; viewer: EventViewer }) {
  if (!tenant || tenant.halls.length === 0) {
    return null;
  }

  return (
    <section className="mb-12">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 className="text-[1.25rem]">Где играют</h2>
        <Contacts tenant={tenant} />
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {tenant.halls.map((hall) => (
          <li key={hall.id} className="rounded-card border border-border bg-surface-raised px-5 py-4">
            <p className="text-[0.9375rem] font-medium">{hall.name}</p>
            <p className="mt-0.5 text-[0.875rem] text-text-muted">{placeOf(hall)}</p>
            <p className="mt-2 text-[0.875rem]">
              Стол — {formatKopecks(hall.tableHourPrice)} в час
              {hall.robotHourPrice !== null && <>, с роботом — {formatKopecks(hall.robotHourPrice)}</>}
            </p>
            <p className="mt-0.5 text-[0.8125rem] text-text-subtle">
              {hall.tables} {plural(hall.tables, 'стол', 'стола', 'столов')} · дальше — по{' '}
              {formatKopecks(hall.tableExtra30MinPrice)} за полчаса
            </p>
          </li>
        ))}
      </ul>

      {/* Ребёнку кнопка не показывается: до 16 за него бронирует родитель, и
          вести его на форму, которая ответит отказом, незачем. */}
      {viewer !== 'staff' && viewer !== 'child' && (
        <div className="mt-4">
          <Link href={viewer === 'anonymous' ? loginHref(`/clubs/${slug}/booking`) : `/clubs/${slug}/booking`}>
            <Button>{viewer === 'anonymous' ? 'Войти и забронировать стол' : 'Забронировать стол'}</Button>
          </Link>
        </div>
      )}

      {viewer === 'child' && (
        <p className="mt-4 text-[0.875rem] text-text-muted">
          Пока тебе нет 16, стол бронирует родитель — со своей страницы.
        </p>
      )}
    </section>
  );
}

/**
 * Где зал: город и адрес одной строкой.
 *
 * Город приписывается к адресу, только если его там ещё нет: администратор
 * заполняет адрес свободной строкой и чаще всего начинает её с города, а
 * «Красноярск, Красноярск, ул. …» читается как ошибка вёрстки.
 */
function placeOf(hall: PublicTenant['halls'][number]): string {
  if (!hall.address) {
    return hall.city ?? 'Адрес не указан';
  }

  const repeats = hall.city !== null && hall.address.toLowerCase().includes(hall.city.toLowerCase());

  return repeats || !hall.city ? hall.address : `${hall.city}, ${hall.address}`;
}

/** Телефон и почта клуба. Нет ни того ни другого — блока нет вовсе. */
function Contacts({ tenant }: { tenant: PublicTenant }) {
  if (!tenant.phone && !tenant.email) {
    return null;
  }

  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.9375rem]">
      {tenant.phone && (
        <a href={`tel:${tenant.phone}`} className="text-text-accent underline-offset-2 hover:underline">
          {tenant.phone}
        </a>
      )}
      {tenant.email && (
        <a href={`mailto:${tenant.email}`} className="text-text-accent underline-offset-2 hover:underline">
          {tenant.email}
        </a>
      )}
    </p>
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

/** «Родителев Коля Олегович» → «Коля». */
function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[1] ?? fullName;
}

/**
 * Мои мероприятия в этом клубе: записи на турниры и свои брони столов. С
 * выбранным ребёнком — его.
 */
function MyEvents({
  entries,
  anonymous,
  whose,
  forPerson,
  readOnly,
}: {
  entries: BookingEntry[] | null;
  anonymous: boolean;
  /** Имя выбранного ребёнка — тогда список его. */
  whose: string | null;
  /** Выбранный ребёнок — «Мои записи» открываются за него. */
  forPerson: string | null;
  /** Смотрит сам ребёнок младше 16: отменять он не может. */
  readOnly: boolean;
}) {
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
      <SectionTitle>{whose ? `Мероприятия: ${whose}` : 'Мои мероприятия'}</SectionTitle>

      {entries === null ? (
        <RowSkeleton />
      ) : (
        <ul className="border-t border-border">
          {upcoming.map((entry) => (
            <li
              key={entry.entryId}
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
                {entryPriceLabel(entry)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[0.8125rem] text-text-subtle">
        {readOnly ? 'Прошедшие — в разделе' : 'Отменить запись и увидеть прошедшие можно в разделе'}{' '}
        <Link
          href={forPerson ? `/my-bookings?for=${forPerson}` : '/my-bookings'}
          className="text-text-accent underline-offset-2 hover:underline"
        >
          «Мои записи»
        </Link>
        .
      </p>
    </section>
  );
}

/** Открытая запись клуба. Аренды столов здесь нет: к чужой броне не присоединиться. */
function Upcoming({
  slug,
  events,
  viewer,
  forPerson,
  selfIsChild,
  onChanged,
}: {
  slug: string;
  events: ClubEvent[] | null;
  viewer: EventViewer;
  forPerson: string | null;
  selfIsChild: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState<ClubEvent | null>(null);

  return (
    <section>
      <SectionTitle>Предстоящие мероприятия</SectionTitle>

      {events === null && <RowSkeleton />}

      {events?.length === 0 && (
        <p className="border-t border-border py-8 text-[0.9375rem] text-text-muted">
          Клуб пока не объявил ни одного занятия и ни одного турнира.
        </p>
      )}

      {viewer === 'staff' && events && events.length > 0 && (
        <p className="mb-4 text-[0.8125rem] text-text-subtle">
          Вы сотрудник этого клуба: записаться на его мероприятие нельзя.
          Расписание занятий и проведение турниров — в разделе «Занятия и турниры».
        </p>
      )}

      {viewer === 'child' && events && events.length > 0 && (
        <p className="mb-4 text-[0.8125rem] text-text-subtle">
          До 16 лет на мероприятия записывает родитель — или администратор клуба у стойки.
        </p>
      )}

      {events && events.length > 0 && (
        <ul className="border-t border-border">
          {/* Ключ из вида и идентификатора: занятия и турниры лежат в разных
              таблицах, и совпадение идентификаторов между ними ничем не
              запрещено. */}
          {events.map((event) => (
            <li key={`${event.kind}-${event.id}`}>
              <EventRow
                slug={slug}
                event={event}
                viewer={viewer}
                forPerson={forPerson}
                onChanged={onChanged}
                onOpen={() => setOpen(event)}
              />
            </li>
          ))}
        </ul>
      )}

      {open && (
        <EventDialog
          slug={slug}
          kind={open.kind}
          id={open.id}
          forPerson={forPerson}
          selfIsChild={selfIsChild}
          onClose={() => setOpen(null)}
          onChanged={onChanged}
        />
      )}
    </section>
  );
}

function EventRow({
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
              <span className="ml-2 text-[0.8125rem] text-text-subtle">
                рейтинг до {event.ratingLabel}
              </span>
            )}
          </button>

          {event.subtitle && (
            <span className="mt-0.5 block text-[0.8125rem] text-text-muted">{event.subtitle}</span>
          )}

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
                {/* Состав — в окне, а не списком в строке: ТЗ требует его
                    показывать, но десяток фамилий в каждой строке расписания
                    превратил бы список мероприятий в простыню. */}
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

        {viewer === 'client' && (
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
