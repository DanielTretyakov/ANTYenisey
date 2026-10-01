'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { BookingEntry, City, ClubCard, ClubPostWithClub, FavouriteClub, FeedEvent, NewsItem } from '@yenisey/types';
import { PlatformMark } from '@/components/brand/PlatformLogo';
import { RiverBackdrop } from '@/components/brand/RiverBackdrop';
import { ClubMark } from '@/components/club/ClubMark';
import { KindBadge } from '@/components/club/EventRow';
import { When, WhenSpan } from '@/components/club/When';
import { EventDialog } from '@/components/events/EventDialog';
import { excerpt, NewsRow, newsDate } from '@/components/news/NewsParts';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { CityCombobox } from '@/components/ui/CityCombobox';
import { RegionCombobox } from '@/components/ui/RegionCombobox';
import { SearchIcon } from '@/components/ui/SearchIcon';
import { api, ApiError } from '@/lib/api';
import {
  ANY_CITY,
  ANY_REGION,
  DEFAULT_CITY,
  readCityPreference,
  readRegionPreference,
  saveCityPreference,
  saveRegionPreference,
} from '@/lib/cityPreference';
import { useClubPostsUnread } from '@/lib/clubPostsUnread';
import { readableOn } from '@/lib/clubTheme';
import { cn } from '@/lib/cn';
import { formatKopecks } from '@/lib/money';
import { plural } from '@/lib/plural';
import { entryPriceLabel } from '@/lib/subscriptions';
import { useSession } from '@/lib/useSession';

/**
 * Стартовая страница платформы.
 *
 * К клубу НЕ привязана (ТЗ → «Стартовая страница»): человек приходит сюда
 * найти зал в своём городе, а не читать про один конкретный клуб.
 *
 * Сверху вниз (решение владельца от 24.09.2026):
 *  1. баннер с поиском — изумрудная плоскость с рекой, как разворот входа;
 *  2. клубы, где играют в выбранном городе (по умолчанию Красноярск);
 *  3. вошедшему — «Мои записи», «Мои клубы» и «Ближайшее в моих клубах»;
 *  4. последние три новости платформы — всем (решение от 26.09.2026).
 *
 * Фотографий залов здесь нет намеренно. Стоковый снимок чужого зала под
 * названием клуба — это ложь о клубе; различает их фирменный цвет и логотип,
 * то есть то, что клуб про себя заявил сам.
 */
export default function StartPage() {
  const session = useSession();

  const [query, setQuery] = useState('');
  // `undefined` — город ещё выясняется (запомненный или Красноярск), `null` —
  // «Любой город». Поиск ждёт первого, иначе мигнул бы список всех клубов.
  const [city, setCity] = useState<City | null | undefined>(undefined);
  // Регион (решение владельца от 30.09.2026): `undefined` — выясняется,
  // `null` — «Любой регион». Выбранный город ставит свой регион сам.
  const [region, setRegion] = useState<string | null | undefined>(undefined);

  const [clubs, setClubs] = useState<ClubCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const stored = readCityPreference();

    const resolve: Promise<City | null> =
      stored === ANY_CITY
        ? Promise.resolve(null)
        : stored
          ? api.city(stored).catch(() => defaultCity())
          : defaultCity();

    void resolve.then((found) => {
      if (cancelled) return;

      const storedRegion = readRegionPreference();

      setCity(found);
      // Город — строже региона: регион у выбранного города всегда его.
      setRegion(
        found?.region ?? (storedRegion === ANY_REGION ? null : (storedRegion ?? (stored ? null : DEFAULT_CITY.region))),
      );
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Пауза перед запросом: без неё каждая буква названия — отдельный поход в
  // базу, и ответы возвращаются вперемешку. Тот же приём, что в поиске людей.
  useEffect(() => {
    if (city === undefined || region === undefined) return;

    let cancelled = false;

    const timer = setTimeout(() => {
      api
        .searchClubs({
          query: query.trim() || undefined,
          cityId: city?.id,
          // С городом регион не нужен: город строже.
          region: city ? undefined : (region ?? undefined),
        })
        .then((found) => {
          if (!cancelled) {
            setClubs(found);
            setError(null);
          }
        })
        .catch((cause: unknown) => {
          if (!cancelled) {
            setClubs([]);
            setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, city, region]);

  function chooseCity(next: City | null): void {
    setCity(next);
    saveCityPreference(next?.id ?? ANY_CITY);

    // Выбрал город — регион становится его регионом.
    if (next?.region) {
      setRegion(next.region);
      saveRegionPreference(next.region);
    }
  }

  function chooseRegion(next: string | null): void {
    setRegion(next);
    saveRegionPreference(next ?? ANY_REGION);

    // Город из другого региона больше не подходит.
    if (city && city.region !== next) {
      setCity(null);
      saveCityPreference(ANY_CITY);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <SiteHeader sticky={false} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 sm:px-8">
        <Hero
          clubs={clubs}
          query={query}
          cityId={city?.id ?? null}
          region={region ?? null}
          onQuery={setQuery}
          onCity={chooseCity}
          onRegion={chooseRegion}
        />

        <StartNav signedIn={session.status === 'ready'} />

        {error && <Alert>{error}</Alert>}

        <Results clubs={clubs} city={city ?? null} region={city ? null : (region ?? null)} query={query.trim()} />

        {session.status === 'ready' && (
          <>
            {/* «Моё» — мозаикой (вариант А от 01.10.2026): ближайшие записи
                крупной плиткой, рядом мои клубы и их новости. */}
            <div className="mt-16 grid gap-4 lg:grid-cols-2">
              <MyEntries />
              <div className="grid content-start gap-4">
                <MyClubs />
                <MyClubPosts />
              </div>
            </div>
            <Nearest />
          </>
        )}

        {session.status !== 'loading' && <LatestNews />}
      </main>

      <footer className="mt-20 border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2.5 px-5 py-9 text-[0.8125rem] text-text-subtle sm:px-8">
          <PlatformMark className="text-[1.25rem]" />
          КНТ — платформа клубов настольного тенниса
          <Link href="/news" className="ml-auto text-text-muted underline-offset-2 hover:underline">
            Новости платформы
          </Link>
        </div>
      </footer>
    </div>
  );
}

/** Красноярск из справочника — по имени и региону, а не зашитым идентификатором. */
async function defaultCity(): Promise<City | null> {
  const found = await api.cities(DEFAULT_CITY.name, 5).catch(() => [] as City[]);

  return found.find((item) => item.name === DEFAULT_CITY.name && item.region === DEFAULT_CITY.region) ?? null;
}

/**
 * Баннер с поиском.
 *
 * Та же изумрудная плоскость с рекой, что у разворота входа: человек, впервые
 * открывший платформу, видит её лицо здесь, а не на форме, до которой ещё не
 * дошёл. Поля — прямо на плоскости: поиск и есть то, ради чего пришли, и
 * уводить его под баннер значило бы сделать баннер заставкой.
 */
function Hero({
  clubs,
  query,
  cityId,
  region,
  onQuery,
  onCity,
  onRegion,
}: {
  /** Выдача — из неё факты на обложке: сколько клубов и городов найдено. */
  clubs: ClubCard[] | null;
  query: string;
  cityId: string | null;
  region: string | null;
  onQuery: (value: string) => void;
  onCity: (city: City | null) => void;
  onRegion: (region: string | null) => void;
}) {
  const cities = new Set((clubs ?? []).flatMap((club) => [club.city, ...club.otherCities].filter(Boolean)));
  const pill = 'inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-[0.8125rem] font-medium';

  return (
    <section
      className="relative mt-6 mb-4 rounded-[1.375rem] px-6 pt-14 pb-9 text-white sm:mt-8 sm:px-11 sm:pt-16"
      // Та же плоскость, что у обложки клуба: изумруд платформы, притемнённый.
      style={{ background: 'color-mix(in oklab, var(--brand-600) 50%, var(--ink-950))' }}
    >
      {/* Обрезка — у слоя с рекой, а не у всего баннера: подсказки города
          выпадают за его нижний край, и overflow-hidden на секции их резал. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[1.375rem]" aria-hidden="true">
        <RiverBackdrop orientation="landscape" />
        <span
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(900px 320px at 85% -10%, color-mix(in oklab, var(--brand-400) 45%, transparent), transparent 65%)',
          }}
        />
      </div>

      <div className="relative z-10">
        <p className="text-[0.75rem] font-semibold tracking-[0.12em] text-white/75 uppercase">
          КНТ · клубы настольного тенниса
        </p>

        <h1 className="mt-4 max-w-4xl font-display text-[2.25rem] leading-[0.98] text-white sm:text-[3.5rem]">
          Найдите зал, где играют рядом с вами
        </h1>

        <p className="mt-4 max-w-3xl font-display text-[1rem] leading-snug text-white/90 sm:text-[1.0625rem]">
          Тренировки. Турниры. Свободные столы. Один аккаунт на все клубы.
        </p>

        {clubs !== null && clubs.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            <span className={pill}>
              {clubs.length} {plural(clubs.length, 'клуб', 'клуба', 'клубов')}
            </span>
            {cities.size > 0 && (
              <span className={pill}>
                {cities.size} {plural(cities.size, 'город', 'города', 'городов')}
              </span>
            )}
            <span className={pill}>запись онлайн</span>
          </div>
        )}

        {/* Поиск — половина ширины, город и регион — по четверти (решение
            владельца от 30.09.2026); уже — поиск строкой, под ним пара. */}
        <div className="mt-8 grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="relative block sm:col-span-2">
            <span className="sr-only">Название клуба</span>
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              placeholder="Название клуба"
              className={cn(
                'h-14 w-full rounded-control border border-transparent bg-surface-raised pr-4 pl-12',
                'text-[1.0625rem] text-text placeholder:text-text-subtle',
              )}
            />
          </label>

          <CityCombobox
            label="Город"
            hideLabel
            emptyLabel="Любой город"
            value={cityId}
            onChange={onCity}
            region={region}
            searchIcon
            placeholder="Город"
            inputClassName="h-14 border-transparent text-[1.0625rem]"
          />

          <RegionCombobox
            label="Регион"
            hideLabel
            emptyLabel="Любой регион"
            value={region}
            onChange={onRegion}
            searchIcon
            placeholder="Регион"
            inputClassName="h-14 border-transparent text-[1.0625rem]"
          />
        </div>
      </div>
    </section>
  );
}

/**
 * Клубы выбранного города — карточками с обложкой в цвете клуба (вариант А от
 * 01.10.2026).
 *
 * Город совпадает, если это город клуба ИЛИ хотя бы одного его зала — правило
 * поиска на сервере, заголовок его не пересказывает, а просто называет город.
 */
function Results({
  clubs,
  city,
  region,
  query,
}: {
  clubs: ClubCard[] | null;
  city: City | null;
  /** Регион без города — тогда заголовок называет регион. */
  region: string | null;
  query: string;
}) {
  // «в городе Красноярск», а не «в Красноярске»: склонять тысячу названий
  // справочника нечем, а неверный падеж хуже честного «в городе».
  const place = city ? ` в городе ${city.name}` : region ? ` — ${region}` : '';
  const title = query
    ? `Клубы по запросу «${query}»${place}`
    : city
      ? `Где играть в городе ${city.name}`
      : region
        ? `Где играть — ${region}`
        : 'Все клубы платформы';

  const unread = useClubPostsUnread();

  return (
    <section id="kluby" className="mt-10 scroll-mt-40">
      <SectionTitle
        description="Клуб находится по городу клуба или любого его зала."
        action={
          clubs !== null && clubs.length > 0 ? (
            <span className="text-[0.875rem] text-text-muted">
              {clubs.length} {plural(clubs.length, 'клуб', 'клуба', 'клубов')}
            </span>
          ) : undefined
        }
      >
        {title}
      </SectionTitle>

      {clubs === null && <CardsSkeleton />}

      {clubs?.length === 0 && (
        <div className="rounded-card border border-dashed border-border px-6 py-10">
          <p className="text-[1.0625rem] text-text">
            {city
              ? `В городе ${city.name} клубов пока нет`
              : region
                ? `В регионе «${region}» клубов пока нет`
                : 'Ничего не нашлось'}
          </p>
          <p className="mt-2 max-w-md text-[0.9375rem] leading-relaxed text-text-muted">
            {query
              ? 'Попробуйте другое написание названия или выберите «Любой город» и «Любой регион».'
              : 'Платформа только открывается. Клубы появятся здесь, как только подключатся.'}
          </p>
        </div>
      )}

      {clubs && clubs.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clubs.map((club) => (
            <li key={club.slug}>
              <ClubTile club={club} unread={unread?.clubs.find((item) => item.slug === club.slug)?.unread ?? 0} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Карточка клуба в выдаче: обложка в цвете клуба, знак на её краю, название
 * шрифтом обложки, города и залы, новое в ленте клуба — счётчиком.
 *
 * Цвет клуба — только плоскостью обложки, притемнённой к чернилам: цвета
 * клубов произвольны, и красить в них текст значило бы не ручаться за
 * контраст ни на светлом, ни на тёмном фоне.
 */
function ClubTile({ club, unread }: { club: ClubCard; unread: number }) {
  const places = [club.city, ...club.otherCities].filter(Boolean).join(', ');
  const accent = club.accentColor ?? 'var(--brand-600)';

  return (
    <Link
      href={`/clubs/${club.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-card border border-border bg-surface-raised transition-colors hover:border-border-strong"
    >
      <span
        aria-hidden="true"
        className="relative block h-28 shrink-0"
        style={{
          background: `radial-gradient(360px 120px at 90% 0%, color-mix(in oklab, ${accent} 60%, transparent), transparent 70%), linear-gradient(135deg, color-mix(in oklab, ${accent} 70%, var(--ink-950)), var(--ink-950))`,
        }}
      />
      <span className="relative -mt-7 px-5">
        {/* Сплошная подложка: монограмма полупрозрачна и на обложке в цвете
            клуба иначе растворяется в ней. */}
        <span className="inline-block rounded-control bg-surface-raised shadow-lg">
          <ClubMark club={club} />
        </span>
      </span>
      <span className="flex grow flex-col px-5 pt-3 pb-5">
        <span className="font-display text-[1.1875rem] leading-snug text-text group-hover:underline">{club.name}</span>
        <span className="mt-1 text-[0.875rem] text-text-muted">
          {places || 'Город не указан'} · {hallsLabel(club.hallCount)}
        </span>
        <span className="mt-auto flex items-center justify-between gap-3 pt-4">
          {unread > 0 ? <UnreadPill count={unread} accent={club.accentColor} /> : <span />}
          <ArrowIcon />
        </span>
      </span>
    </Link>
  );
}

/**
 * «Мои записи» коротко: три ближайшие и ссылка на раздел целиком.
 *
 * Отмена и история — там, а не здесь: второй список с кнопками отмены
 * разошёлся бы с разделом в том, что обещает списать (ТЗ требует одного
 * места для записей).
 */
function MyEntries() {
  const [entries, setEntries] = useState<BookingEntry[] | null>(null);

  useEffect(() => {
    api
      .myBookings()
      .then(setEntries)
      .catch(() => setEntries([]));
  }, []);

  const upcoming = (entries ?? [])
    .filter((entry) => entry.status === 'BOOKED' && new Date(entry.endsAt).getTime() > Date.now())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const [first, ...rest] = upcoming;
  // Пустая плитка не тянется на высоту соседней колонки: крупный пустой
  // прямоугольник ничего не сообщает.
  const empty = entries !== null && upcoming.length === 0;

  return (
    <section
      id="moi-zapisi"
      className={`flex scroll-mt-40 flex-col rounded-card border border-border bg-gradient-to-br from-surface-accent-soft to-surface-raised p-6${empty ? ' self-start' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className={KICKER}>Мои записи</p>
        <Link href="/my-bookings">
          <Button variant="secondary" size="sm">
            Подробнее
          </Button>
        </Link>
      </div>

      {entries === null && <ResultsSkeleton rows={2} />}

      {entries !== null && upcoming.length === 0 && (
        <p className="mt-4 text-[0.9375rem] text-text-muted">
          Предстоящих записей нет. Выберите клуб выше — и запишитесь на занятие или турнир.
        </p>
      )}

      {/* Ближайшая — крупно, шрифтом обложки. */}
      {first && (
        <div className="mt-4">
          <p className="font-display text-[1.75rem] leading-tight text-text">
            <When instant={first.startsAt} />
          </p>
          <p className="mt-2 text-[1.0625rem] text-text">{first.title}</p>
          <p className="text-[0.875rem] text-text-muted">
            {first.club.name}
            {first.subtitle && ` · ${first.subtitle}`} · {entryPriceLabel(first)}
          </p>
        </div>
      )}

      {rest.length > 0 && (
        <ul className="mt-5 border-t border-border">
          {rest.slice(0, 2).map((entry) => (
            <li
              key={entry.entryId}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border py-4"
            >
              <WhenSpan startsAt={entry.startsAt} endsAt={entry.endsAt} />

              <span className="min-w-0 grow">
                <span className="block text-[0.9375rem] text-text">{entry.title}</span>
                <span className="block text-[0.8125rem] text-text-muted">
                  {entry.club.name}
                  {entry.subtitle && ` · ${entry.subtitle}`}
                </span>
              </span>

              <span className="text-[0.875rem] whitespace-nowrap text-text-muted">{entryPriceLabel(entry)}</span>
            </li>
          ))}
        </ul>
      )}

      {upcoming.length > 3 && (
        <p className="mt-auto pt-3 text-[0.8125rem] text-text-subtle">
          И ещё {upcoming.length - 3} — в разделе «Мои записи».
        </p>
      )}
    </section>
  );
}

/** Мои клубы — плитками: их не больше трёх, и каждую открывают, а не читают. */
function MyClubs() {
  const [clubs, setClubs] = useState<FavouriteClub[] | null>(null);
  // Непрочитанные новости клуба — счётчиком на карточке (решение от 30.09.2026).
  const unread = useClubPostsUnread();
  const unreadOf = (slug: string): number => unread?.clubs.find((club) => club.slug === slug)?.unread ?? 0;

  useEffect(() => {
    api
      .myClubs()
      .then(setClubs)
      .catch(() => setClubs([]));
  }, []);

  return (
    <section id="moi-kluby" className="scroll-mt-40 rounded-card border border-border bg-surface-raised p-5">
      <p className={cn(KICKER, 'mb-3')}>Мои клубы</p>

      {clubs !== null && clubs.length === 0 && (
        <p className="text-[0.9375rem] text-text-muted">
          Своих клубов пока нет. Отметьте клуб сердечком на его странице — он появится здесь.
        </p>
      )}

      {clubs && clubs.length > 0 && (
        <ul className="grid gap-1">
          {clubs.map((club) => (
            <li key={club.slug}>
              <Link
                href={unreadOf(club.slug) > 0 ? `/clubs/${club.slug}/news` : `/clubs/${club.slug}`}
                className="group flex items-center gap-3 rounded-control px-2 py-2 transition-colors hover:bg-surface-sunken"
              >
                <ClubMark club={club} size="sm" />
                <span className="min-w-0 grow">
                  <span className="block truncate text-[1rem] text-text">{club.name}</span>
                  <span className="block truncate text-[0.8125rem] text-text-muted">
                    {club.city ?? 'Город не указан'}
                  </span>
                </span>
                {unreadOf(club.slug) > 0 ? (
                  <UnreadPill count={unreadOf(club.slug)} accent={club.accentColor} />
                ) : (
                  <ArrowIcon />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Ближайшее в моих клубах: пять ближайших неповторяющихся мероприятий.
 *
 * Отбор «неповторяющихся» — на сервере (`distinctNearest`): иначе пять строк
 * заняла бы одна группа, собирающаяся через день. Строка открывает окно
 * мероприятия, а не страницу клуба: вопрос у человека — «что это и кто идёт».
 */
function Nearest() {
  const [events, setEvents] = useState<FeedEvent[] | null>(null);
  const [open, setOpen] = useState<FeedEvent | null>(null);

  const load = (): void => {
    api
      .feed()
      .then(setEvents)
      .catch(() => setEvents([]));
  };

  useEffect(load, []);

  if (events !== null && events.length === 0) {
    return null;
  }

  return (
    <section id="blizhaishee" className="mt-16 scroll-mt-40">
      <SectionTitle description="Ближайшие занятия и турниры клубов, где вы бываете, — запись в окне мероприятия.">
        Ближайшее в моих клубах
      </SectionTitle>

      {events === null && <CardsSkeleton />}

      {events && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <li key={`${event.club.slug}-${event.kind}-${event.id}`}>
              <button
                type="button"
                onClick={() => setOpen(event)}
                className="group flex h-full w-full flex-col rounded-card border border-border bg-surface-raised px-5 py-4 text-left transition-colors hover:border-border-strong"
              >
                <span className={KICKER}>{dayLabel(event.startsAt)}</span>
                <span className="mt-1.5 font-display text-[1.375rem] text-text">{timeLabel(event.startsAt)}</span>
                <span className="mt-1 flex flex-wrap items-center gap-2">
                  <KindBadge kind={event.kind} />
                  <span className="text-[0.9375rem] text-text group-hover:underline">{event.title}</span>
                </span>
                <span className="mt-1 text-[0.8125rem] text-text-muted">
                  {event.club.name}
                  {event.subtitle && ` · ${event.subtitle}`} · {formatKopecks(event.price)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <EventDialog
          slug={open.club.slug}
          kind={open.kind}
          id={open.id}
          onClose={() => setOpen(null)}
          onChanged={load}
        />
      )}
    </section>
  );
}

/**
 * «Новости моих клубов» (решение владельца от 26.09.2026): последние три
 * публикации клубов, отмеченных своими и где человек клиент. Нет публикаций —
 * нет и блока.
 */
function MyClubPosts() {
  const [items, setItems] = useState<ClubPostWithClub[] | null>(null);

  useEffect(() => {
    api
      .myClubPosts(3)
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  if (!items || items.length === 0) {
    return null;
  }

  return (
    <section id="novosti-klubov" className="scroll-mt-40 rounded-card border border-border bg-surface-raised p-5">
      <p className={cn(KICKER, 'mb-1')}>Новости моих клубов</p>

      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.id} className="py-3">
            <p className="mb-1.5 flex flex-wrap items-center gap-x-2 text-[0.8125rem] text-text-subtle">
              {item.unread && (
                <span className="inline-flex items-center gap-1.5 font-medium text-text-accent">
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-full"
                    style={{ background: item.club.accentColor ?? 'var(--accent)' }}
                  />
                  Новое
                </span>
              )}
              <span className="font-medium text-text-muted">{item.club.name}</span>
              {item.publishedAt && <span>· {newsDate(item.publishedAt)}</span>}
            </p>
            <Link href={`/clubs/${item.club.slug}/news/${item.id}`} className="group block">
              <h3
                className={cn(
                  'text-[1.0625rem] text-text group-hover:text-text-accent',
                  item.unread ? 'font-bold' : 'font-semibold',
                )}
              >
                {item.title}
              </h3>
              <p className="mt-1 line-clamp-2 text-[0.9375rem] text-text-muted">{excerpt(item.body)}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Последние три новости платформы (решение владельца от 26.09.2026). Ждёт
 * сессию: вошедшему сотруднику клуба сервер отдаёт и «Для клубов». Новостей
 * нет — блока нет: пустой заголовок на стартовой ничего не сообщает.
 */
function LatestNews() {
  const [items, setItems] = useState<NewsItem[] | null>(null);

  useEffect(() => {
    api
      .news({ limit: 3 })
      .then((feed) => setItems(feed.items))
      .catch(() => setItems([]));
  }, []);

  if (!items || items.length === 0) {
    return null;
  }

  return (
    <section id="novosti-platformy" className="mt-16 scroll-mt-40">
      <SectionTitle
        description="Что нового в КНТ: общие новости и обновления."
        action={
          <Link href="/news">
            <Button variant="secondary" size="sm">
              Все новости
            </Button>
          </Link>
        }
      >
        Новости платформы
      </SectionTitle>

      <ul className="rounded-card border border-border bg-surface-raised px-5 [&>li:last-child]:border-b-0">
        {items.map((item) => (
          <NewsRow key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}

/** «2 новых» в цвете клуба — на карточке «Моих клубов». */
function UnreadPill({ count, accent }: { count: number; accent: string | null }) {
  return (
    <span
      className="shrink-0 rounded-full px-2.5 py-0.5 text-[0.8125rem] font-medium whitespace-nowrap"
      style={{
        background: accent ?? 'var(--accent)',
        color: accent ? readableOn(accent) : 'var(--accent-text)',
      }}
    >
      {count} {plural(count, 'новая', 'новые', 'новых')}
    </span>
  );
}

/** Подпись плитки — мелкими прописными, как на странице клуба. */
const KICKER = 'text-[0.75rem] font-semibold tracking-[0.1em] text-text-subtle uppercase';

/** Заголовок блока — шрифтом обложки, с описанием, как на странице клуба. */
function SectionTitle({
  children,
  description,
  action,
}: {
  children: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="min-w-0 max-w-3xl">
        <h2 className="font-display text-[1.375rem] leading-tight sm:text-[1.5rem]">{children}</h2>
        {description && <p className="mt-1 text-[0.9375rem] text-text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * Липкое меню разделов стартовой (вариант А от 01.10.2026) — как на странице
 * клуба. Гостю — клубы и новости платформы; вошедшему — и своё. У «Моих
 * клубов» — число непрочитанного в их лентах. Пункт ведёт к блоку, которого
 * может не быть (нет новостей), — тогда меню его не показывает.
 */
function StartNav({ signedIn }: { signedIn: boolean }) {
  const unread = useClubPostsUnread();
  const [present, setPresent] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);

  const items = [
    { id: 'kluby', label: 'Клубы' },
    ...(signedIn
      ? [
          { id: 'moi-zapisi', label: 'Мои записи' },
          { id: 'moi-kluby', label: 'Мои клубы' },
          { id: 'novosti-klubov', label: 'Новости клубов' },
          { id: 'blizhaishee', label: 'Ближайшее' },
        ]
      : []),
    { id: 'novosti-platformy', label: 'Новости платформы' },
  ];
  const ids = items.map((item) => item.id).join(',');

  // Какие блоки есть на странице и какой сейчас под меню.
  useEffect(() => {
    const list = ids.split(',');
    const check = (): void => {
      setPresent(list.filter((id) => document.getElementById(id)));

      let current: string | null = null;
      let currentTop = -Infinity;

      for (const id of list) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top !== undefined && top < 180 && top > currentTop + 1) {
          current = id;
          currentTop = top;
        }
      }

      setActive(current);
    };

    check();
    const timer = window.setInterval(check, 1500);
    window.addEventListener('scroll', check, { passive: true });

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('scroll', check);
    };
  }, [ids]);

  const shown = items.filter((item) => present.includes(item.id));

  if (shown.length < 2) {
    return null;
  }

  return (
    <nav
      aria-label="Разделы стартовой"
      className="sticky top-0 z-10 -mx-1 mb-2 overflow-x-auto rounded-card border border-border bg-surface-raised/90 p-1.5 backdrop-blur [scrollbar-width:none]"
    >
      <ul className="flex w-max gap-1">
        {shown.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              aria-current={active === item.id ? 'true' : undefined}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[0.875rem] whitespace-nowrap transition-colors',
                active === item.id ? 'bg-accent text-accent-text' : 'text-text-muted hover:bg-surface-sunken hover:text-text',
              )}
            >
              {item.label}
              {item.id === 'moi-kluby' && (unread?.total ?? 0) > 0 && (
                <span
                  className={cn(
                    'grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full px-1 text-[0.6875rem] font-semibold',
                    active === item.id ? 'bg-accent-text text-accent' : 'bg-accent text-accent-text',
                  )}
                >
                  {unread!.total}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** «Пятница, 2 октября» — подпись карточки ближайшего, по часам смотрящего, как `When`. */
function dayLabel(instant: string): string {
  const label = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(instant),
  );

  return label.charAt(0).toUpperCase() + label.slice(1);
}

function timeLabel(instant: string): string {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(instant));
}

/** Заглушка карточек — той же сетки, что выдача: список не подпрыгивает. */
function CardsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
      {[0, 1, 2].map((key) => (
        <div key={key} className="h-52 rounded-card border border-border bg-surface-raised" />
      ))}
    </div>
  );
}

/**
 * Заглушка выдачи.
 *
 * Полосы той же высоты и в том же ритме, что будущие строки: список не
 * подпрыгивает в момент ответа сервера. Тот же приём, что у скелета профиля.
 */
function ResultsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="border-t border-border" aria-busy="true">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-4 border-b border-border py-5 pl-4 sm:pl-6">
          <span className="h-12 w-12 shrink-0 rounded-control bg-border/50" />
          <span className="grow">
            <span className="block h-3.5 w-48 rounded-full bg-border/50" />
            <span className="mt-2 block h-2.5 w-28 rounded-full bg-border/40" />
          </span>
        </div>
      ))}
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-5 w-5 shrink-0 text-text-subtle transition-transform group-hover:translate-x-0.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m7.5 4 6 6-6 6" />
    </svg>
  );
}

/** «3 зала». Число рядом со словом в правильной форме — иначе строка выглядит машинной. */
function hallsLabel(count: number): string {
  if (count === 0) {
    return 'Залов пока нет';
  }

  const tail = count % 10;
  const hundred = count % 100;

  if (tail === 1 && hundred !== 11) {
    return `${count} зал`;
  }

  if (tail >= 2 && tail <= 4 && (hundred < 12 || hundred > 14)) {
    return `${count} зала`;
  }

  return `${count} залов`;
}
