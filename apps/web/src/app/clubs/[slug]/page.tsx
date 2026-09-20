'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { BookingEntry, ClubEvent, PublicTenant } from '@yenisey/types';
import { ClubMark } from '@/components/club/ClubMark';
import { PersonSwitch } from '@/components/family/PersonSwitch';
import { WhenSpan } from '@/components/club/When';
import { ClubNav } from '@/components/layout/ClubNav';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { api, ApiError } from '@/lib/api';
import { clubAccent } from '@/lib/clubTheme';
import { cn } from '@/lib/cn';
import { formatKopecks } from '@/lib/money';
import { entryPriceLabel } from '@/lib/subscriptions';
import { roleInClub } from '@/lib/membership';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { usePersonSwitch } from '@/lib/usePersonSwitch';
import { useSession } from '@/lib/useSession';

/**
 * Кем человек приходится этому клубу — с точки зрения кнопки «Записаться».
 *
 * `child` — вошедшему нет 16, и он смотрит сам за себя: записывает его
 * родитель или администратор у стойки.
 */
type Viewer = 'anonymous' | 'client' | 'staff' | 'child';

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
   *
   * За выбранного ребёнка родитель — всегда клиент, даже если сам он тренер
   * этого клуба: право на запись проверяется у того, за кого пишут (решение
   * от 17.09.2026). Сотрудником ребёнка сервер всё равно не пропустит.
   */
  const viewer: Viewer =
    session.status !== 'ready'
      ? 'anonymous'
      : forPerson
        ? 'client'
        : (roleInClub(session.user, slug) ?? 'CLIENT') !== 'CLIENT'
          ? 'staff'
          : family.selfIsChild
            ? 'child'
            : 'client';

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

        <MyEvents
          entries={mine}
          anonymous={session.status === 'anonymous'}
          whose={family.selected ? firstName(family.selected.fullName) : null}
          forPerson={forPerson}
          readOnly={family.selfIsChild}
        />

        <Upcoming
          events={events}
          viewer={viewer}
          forPerson={forPerson}
          onChanged={() => {
            loadEvents();
            club.myEvents(forPerson).then(setMine).catch(() => undefined);
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
  events,
  viewer,
  forPerson,
  onChanged,
}: {
  events: ClubEvent[] | null;
  viewer: Viewer;
  forPerson: string | null;
  onChanged: () => void;
}) {
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
              <EventRow event={event} viewer={viewer} forPerson={forPerson} onChanged={onChanged} />
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
  forPerson,
  onChanged,
}: {
  event: ClubEvent;
  viewer: Viewer;
  forPerson: string | null;
  onChanged: () => void;
}) {
  const club = useClubApi();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showParticipants, setShowParticipants] = useState(false);

  // Мест нет — но записанному кнопка отмены нужна и на переполненном занятии.
  const full = event.freeSeats === 0 && !event.registered;

  async function toggle(): Promise<void> {
    setPending(true);
    setError(null);

    try {
      if (event.kind === 'TRAINING') {
        await (event.registered
          ? club.cancelTrainingBooking(event.id, forPerson)
          : club.registerForTraining(event.id, forPerson));
      } else {
        await (event.registered
          ? club.cancelTournamentRegistration(event.id, forPerson)
          : club.registerForTournament(event.id, forPerson));
      }

      onChanged();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="border-b border-border py-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {/* У занятия известно окончание, у турнира нет: WhenSpan сам сводится к
            одной строке времени, когда конца не задано. */}
        <WhenSpan startsAt={event.startsAt} endsAt={event.endsAt} />

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
                {/* Состав раскрывается по требованию, а не висит списком: ТЗ
                    требует его показывать, но десяток фамилий в каждой строке
                    расписания превратил бы список мероприятий в простыню. */}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-text"
                  aria-expanded={showParticipants}
                  onClick={() => setShowParticipants((shown) => !shown)}
                >
                  {showParticipants ? 'скрыть состав' : 'кто записан'}
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
            onClick={() => void toggle()}
          >
            {event.registered ? 'Отменить запись' : full ? 'Мест нет' : 'Записаться'}
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

      {showParticipants && event.participants.length > 0 && (
        <p className="mt-3 text-[0.8125rem] text-text-muted">
          {event.participants.join(', ')}
        </p>
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

/**
 * Сколько занято и сколько осталось.
 *
 * У турнира лимита мест нет — там остаётся только число записавшихся. Ноль
 * показывается словом: «0 записавшихся» читается как ошибка, а не как пустое
 * занятие.
 */
function seatsLabel(event: ClubEvent): string {
  if (event.freeSeats === null) {
    return event.registeredCount === 0
      ? 'Пока никто не записался'
      : `Записались: ${event.registeredCount}`;
  }

  if (event.freeSeats === 0) {
    return 'Мест нет';
  }

  return `Осталось ${event.freeSeats} из ${event.capacity}`;
}
