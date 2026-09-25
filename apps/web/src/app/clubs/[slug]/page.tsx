'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BookingEntry, ClubEvent, PublicTenant } from '@yenisey/types';
import { RiverBackdrop } from '@/components/brand/RiverBackdrop';
import { ClubMark } from '@/components/club/ClubMark';
import { EventDialog } from '@/components/events/EventDialog';
import { PersonSwitch } from '@/components/family/PersonSwitch';
import { WhenSpan } from '@/components/club/When';
import { ClubNav } from '@/components/layout/ClubNav';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { Alert } from '@/components/ui/Alert';
import { PlayerAvatar } from '@/components/player/PlayerView';
import { Button } from '@/components/ui/Button';
import { Tab } from '@/components/ui/Tab';
import { api, ApiError } from '@/lib/api';
import { clubAccent } from '@/lib/clubTheme';
import { cn } from '@/lib/cn';
import { inputClassName } from '@/components/ui/Field';
import { eventViewerOf, seatsLabel, useEventAction, type EventViewer } from '@/lib/eventViewer';
import { formatKopecks } from '@/lib/money';
import { plural } from '@/lib/plural';
import { entryPriceLabel } from '@/lib/subscriptions';
import { loginHref } from '@/lib/next';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { usePersonSwitch } from '@/lib/usePersonSwitch';
import { useFileUrl } from '@/lib/useFileUrl';
import { useSession } from '@/lib/useSession';
import { sameDay, weekDays, weekEnd, weekLabel, weekStart } from '@/lib/week';

/**
 * Страница клуба.
 *
 * Сверху вниз (решение владельца от 24.09.2026): баннер с названием и
 * сердечком «мой клуб», описание, аренда и залы, «Мои мероприятия»,
 * «Предстоящие» с выбором недели и дня, тренерский состав.
 *
 * Порядок «Мои» → «Предстоящие» задан ТЗ и не косметический. На страницу клуба заходят чаще всего чтобы посмотреть, куда
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
  // Счётчик перечитываний «Предстоящих»: список грузит сам блок (у него своя
  // неделя), страница только говорит «после записи прочитай заново».
  const [eventsVersion, setEventsVersion] = useState(0);
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

  // После записи или отмены — и в строке, и в окне — обновляются оба списка:
  // «Мои мероприятия» и отметка «записан» в предстоящих.
  const refreshEvents = useCallback(() => {
    setEventsVersion((value) => value + 1);
    club.myEvents(forPerson).then(setMine).catch(() => undefined);
  }, [club, forPerson]);

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
        <ClubHero
          tenant={tenant}
          slug={slug}
          anonymous={session.status === 'anonymous'}
          favourite={favourite}
          onFavourite={setFavourite}
        />

        {error && <Alert>{error}</Alert>}

        {tenant?.description && (
          <p className="mb-10 max-w-3xl text-[1rem] leading-relaxed whitespace-pre-line text-text">
            {tenant.description}
          </p>
        )}

        <BookingCta slug={slug} viewer={viewer} />

        <PersonSwitch
          people={family.children}
          selected={family.selected}
          onChoose={family.choose}
          className="mb-10"
        />

        <Halls tenant={tenant} />

        <MyEvents
          entries={mine}
          anonymous={session.status === 'anonymous'}
          whose={family.selected ? firstName(family.selected.fullName) : null}
          forPerson={forPerson}
          readOnly={family.selfIsChild}
        />

        <Upcoming
          slug={slug}
          version={eventsVersion}
          viewer={viewer}
          forPerson={forPerson}
          selfIsChild={family.selfIsChild}
          onChanged={refreshEvents}
        />

        <Coaches tenant={tenant} />
      </main>
    </div>
  );
}

/**
 * Баннер клуба: снимок, который клуб загрузил сам, или фирменная плоскость с
 * рекой — в цвете клуба. Название, города и сердечко «мой клуб» — на нём.
 *
 * Высота задана до ответа сервера — иначе содержимое страницы подпрыгивало
 * бы, когда приедут название и снимок.
 */
function ClubHero({
  tenant,
  slug,
  anonymous,
  favourite,
  onFavourite,
}: {
  tenant: PublicTenant | null;
  slug: string;
  anonymous: boolean;
  favourite: boolean | null;
  onFavourite: (value: boolean) => void;
}) {
  const banner = useFileUrl(tenant?.bannerFileId ?? null);
  const places = tenant ? [tenant.city, ...tenant.otherCities].filter(Boolean).join(', ') : '';

  return (
    <header className="relative mt-6 mb-8 overflow-hidden rounded-card text-white sm:mt-8">
      <div
        className="relative flex min-h-56 items-end px-6 pt-16 pb-6 sm:min-h-72 sm:px-10 sm:pb-8"
        // Без баннера — плоскость в цвете клуба, притемнённая: белый текст на
        // произвольном фирменном цвете иначе читался бы не всегда.
        style={{ background: 'color-mix(in oklab, var(--accent) 55%, var(--ink-950))' }}
      >
        {banner ? (
          <>
            <img src={banner} alt="" className="absolute inset-0 h-full w-full object-cover" />
            {/* Затемнение снизу — под названием: снимок зала бывает светлым. */}
            <span
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(to top, color-mix(in oklab, var(--ink-950) 80%, transparent), transparent 70%)',
              }}
            />
          </>
        ) : (
          <RiverBackdrop orientation="landscape" />
        )}

        <div className="relative z-10 flex w-full flex-wrap items-end gap-x-5 gap-y-4">
          {tenant ? (
            <ClubMark club={tenant} size="lg" />
          ) : (
            <span className="h-16 w-16 shrink-0 rounded-control bg-white/20" aria-hidden="true" />
          )}

          <div className="min-w-0 grow">
            {tenant ? (
              <>
                <h1 className="text-[1.75rem] leading-tight text-white [overflow-wrap:anywhere] sm:text-[2.25rem]">
                  {tenant.name}
                </h1>
                {places && <p className="mt-1.5 text-[0.9375rem] text-white/80">{places}</p>}
              </>
            ) : (
              <>
                <span className="block h-7 w-64 rounded-full bg-white/20" />
                <span className="mt-3 block h-3 w-32 rounded-full bg-white/15" />
              </>
            )}
          </div>

          <HeartButton slug={slug} anonymous={anonymous} favourite={favourite} onChange={onFavourite} />
        </div>
      </div>
    </header>
  );
}

/**
 * «Забронировать стол» — сразу под баннером и описанием (решение владельца
 * от 24.09.2026), а не под списком залов: у клуба с десятком залов кнопка
 * уезжала за второй экран.
 *
 * Сотруднику кнопка не показывается — бронь ссылается на карточку клиента,
 * которой у него нет. Ребёнку — тоже: до 16 за него бронирует родитель.
 */
function BookingCta({ slug, viewer }: { slug: string; viewer: EventViewer }) {
  if (viewer === 'staff') {
    return null;
  }

  if (viewer === 'child') {
    return (
      <p className="mb-10 text-[0.875rem] text-text-muted">
        Пока тебе нет 16, стол бронирует родитель — со своей страницы.
      </p>
    );
  }

  // Анониму — тоже сразу на сетку: она открыта без входа, и вход понадобится
  // только на последнем шаге, с возвратом туда же.
  return (
    <div className="mb-10">
      <Link href={`/clubs/${slug}/booking`}>
        <Button size="lg">Забронировать стол</Button>
      </Link>
    </div>
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
 * Отсюда контакты рядом с залами; кнопка аренды — выше, под баннером
 * (`BookingCta`).
 */
function Halls({ tenant }: { tenant: PublicTenant | null }) {
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
 * Сердечко «мой клуб» (решение владельца от 24.09.2026): контур — не отмечен,
 * красная заливка — отмечен.
 *
 * Избранное и заявленная принадлежность — одна кнопка, а не две: разделять их
 * значило бы объяснять человеку разницу, которой в его голове нет. Анониму
 * сердечко ведёт ко входу и обратно сюда.
 */
function HeartButton({
  slug,
  anonymous,
  favourite,
  onChange,
}: {
  slug: string;
  anonymous: boolean;
  favourite: boolean | null;
  onChange: (value: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = favourite === true;
  const label = active ? 'Убрать из моих клубов' : 'Сделать клуб своим';

  async function toggle(): Promise<void> {
    setPending(true);
    setError(null);

    try {
      const clubs = active ? await api.removeClub(slug) : await api.addClub(slug);
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

  const heart = (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <path
        d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"
        fill={active ? '#e5484d' : 'none'}
        stroke={active ? '#e5484d' : 'currentColor'}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );

  const className = cn(
    'grid h-12 w-12 shrink-0 place-items-center rounded-full border border-white/40 bg-black/25 text-white',
    'backdrop-blur-sm transition-transform hover:scale-105 disabled:opacity-60',
  );

  return (
    <div className="flex flex-col items-end gap-2">
      {anonymous ? (
        <Link href={loginHref()} aria-label="Войти, чтобы сделать клуб своим" title="Войти, чтобы сделать клуб своим" className={className}>
          {heart}
        </Link>
      ) : (
        <button
          type="button"
          aria-pressed={active}
          aria-label={label}
          title={label}
          disabled={pending || favourite === null}
          onClick={() => void toggle()}
          className={className}
        >
          {heart}
        </button>
      )}

      {error && (
        <p className="max-w-xs rounded-control bg-black/60 px-3 py-2 text-right text-[0.8125rem] text-white" role="alert">
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

/**
 * Открытая запись клуба. Аренды столов здесь нет: к чужой броне не присоединиться.
 *
 * Неделя, день недели или вся неделя и поиск по названию (решение владельца от
 * 24.09.2026). Неделя грузится с сервера окном `from`/`to`; поиск ищет по всем
 * предстоящим, без окна: «когда ближайший „Клуб 100“» — вопрос не о неделе.
 */
function Upcoming({
  slug,
  version,
  viewer,
  forPerson,
  selfIsChild,
  onChanged,
}: {
  slug: string;
  /** Растёт после записи или отмены — список перечитывается. */
  version: number;
  viewer: EventViewer;
  forPerson: string | null;
  selfIsChild: boolean;
  onChanged: () => void;
}) {
  const club = useClubApi();
  const [open, setOpen] = useState<ClubEvent | null>(null);
  const [offset, setOffset] = useState(0);
  const [day, setDay] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState<ClubEvent[] | null>(null);

  const start = useMemo(() => weekStart(new Date(), offset), [offset]);
  const days = useMemo(() => weekDays(start), [start]);
  const searching = query.trim() !== '';

  // С выбранным ребёнком отметка «записан» в списке — его, а не родителя.
  useEffect(() => {
    let cancelled = false;
    const range = searching ? undefined : { from: start.toISOString(), to: weekEnd(start).toISOString() };

    const timer = setTimeout(
      () => {
        club
          .events(forPerson, range)
          .then((found) => {
            if (!cancelled) setLoaded(found);
          })
          .catch(() => {
            if (!cancelled) setLoaded([]);
          });
      },
      searching ? 250 : 0,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [club, forPerson, start, searching, query, version]);

  const needle = query.trim().toLowerCase();
  const events =
    loaded === null
      ? null
      : loaded.filter((event) =>
          searching
            ? `${event.title} ${event.subtitle ?? ''}`.toLowerCase().includes(needle)
            : day === null || sameDay(new Date(event.startsAt), days[day]!),
        );
  const today = new Date();

  return (
    <section className="mb-16">
      <SectionTitle>Предстоящие мероприятия</SectionTitle>

      <div className="mb-5 grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label="Предыдущая неделя"
            disabled={offset === 0 || searching}
            onClick={() => {
              setOffset((value) => value - 1);
              setDay(null);
            }}
            className="grid h-9 w-9 place-items-center rounded-control border border-border text-text-muted hover:bg-surface-sunken disabled:opacity-40"
          >
            ‹
          </button>
          <span className={cn('min-w-44 text-center text-[0.9375rem]', searching && 'text-text-subtle')}>
            {offset === 0 ? 'Эта неделя' : offset === 1 ? 'Следующая неделя' : weekLabel(start)}
            <span className="block text-[0.75rem] text-text-subtle">{weekLabel(start)}</span>
          </span>
          <button
            type="button"
            aria-label="Следующая неделя"
            disabled={offset >= 7 || searching}
            onClick={() => {
              setOffset((value) => value + 1);
              setDay(null);
            }}
            className="grid h-9 w-9 place-items-center rounded-control border border-border text-text-muted hover:bg-surface-sunken disabled:opacity-40"
          >
            ›
          </button>

          <label className="ml-auto w-full sm:w-64">
            <span className="sr-only">Поиск мероприятия</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Найти мероприятие"
              className={cn(inputClassName, 'py-2')}
            />
          </label>
        </div>

        {!searching && (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="День недели">
            <Tab inTablist active={day === null} onClick={() => setDay(null)}>
              Вся неделя
            </Tab>
            {days.map((date, index) => (
              <Tab
                key={date.toISOString()}
                inTablist
                active={day === index}
                onClick={() => setDay(index)}
              >
                <span className={cn(date < new Date(today.getFullYear(), today.getMonth(), today.getDate()) && 'opacity-50')}>
                  {DAY_NAMES[index]} {date.getDate()}
                </span>
              </Tab>
            ))}
          </div>
        )}
      </div>

      {events === null && <RowSkeleton />}

      {events?.length === 0 && (
        <p className="border-t border-border py-8 text-[0.9375rem] text-text-muted">
          {searching
            ? `По запросу «${query.trim()}» предстоящих мероприятий нет.`
            : day === null
              ? 'На этой неделе мероприятий нет — загляните на следующую.'
              : 'В этот день мероприятий нет.'}
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

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/**
 * Тренерский состав: тех, кого выбрал и упорядочил администратор (решение
 * владельца от 24.09.2026). Карточка — у самого тренера, `/coaches/:id`.
 */
function Coaches({ tenant }: { tenant: PublicTenant | null }) {
  if (!tenant || tenant.coaches.length === 0) {
    return null;
  }

  return (
    <section>
      <SectionTitle>Тренеры клуба</SectionTitle>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tenant.coaches.map((coach) => (
          <li key={coach.id}>
            <Link
              href={`/coaches/${coach.id}`}
              className="group flex h-full items-center gap-4 rounded-card border border-border bg-surface-raised px-5 py-4 transition-colors hover:border-border-strong"
            >
              <PlayerAvatar fileId={coach.photoFileId} name={coach.name} size="md" />
              <span className="min-w-0 grow">
                <span className="block truncate text-[1rem] text-text group-hover:underline">{coach.name}</span>
                <span className="mt-0.5 block text-[0.8125rem] text-text-muted">
                  {coachPrices(coach) ?? 'Цены — у тренера'}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** «Группа — 700 ₽ · Индивидуально — 2 000 ₽», только то, что тренер указал. */
function coachPrices(coach: PublicTenant['coaches'][number]): string | null {
  const parts = [
    coach.groupPrice !== null ? `Группа — ${formatKopecks(coach.groupPrice)}` : null,
    coach.individualPrice !== null ? `Индивидуально — ${formatKopecks(coach.individualPrice)}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' · ') : null;
}
