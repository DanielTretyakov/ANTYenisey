'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { BookingEntry, City, ClubCard, FavouriteClub, FeedEvent, NewsItem } from '@yenisey/types';
import { PlatformMark } from '@/components/brand/PlatformLogo';
import { RiverBackdrop } from '@/components/brand/RiverBackdrop';
import { ClubMark } from '@/components/club/ClubMark';
import { When, WhenSpan } from '@/components/club/When';
import { EventDialog } from '@/components/events/EventDialog';
import { NewsRow } from '@/components/news/NewsParts';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { CityCombobox } from '@/components/ui/CityCombobox';
import { api, ApiError } from '@/lib/api';
import { ANY_CITY, DEFAULT_CITY, readCityPreference, saveCityPreference } from '@/lib/cityPreference';
import { cn } from '@/lib/cn';
import { formatKopecks } from '@/lib/money';
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
      if (!cancelled) setCity(found);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Пауза перед запросом: без неё каждая буква названия — отдельный поход в
  // базу, и ответы возвращаются вперемешку. Тот же приём, что в поиске людей.
  useEffect(() => {
    if (city === undefined) return;

    let cancelled = false;

    const timer = setTimeout(() => {
      api
        .searchClubs({ query: query.trim() || undefined, cityId: city?.id })
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
  }, [query, city]);

  function chooseCity(next: City | null): void {
    setCity(next);
    saveCityPreference(next?.id ?? ANY_CITY);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <SiteHeader sticky={false} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 sm:px-8">
        <Hero query={query} cityId={city?.id ?? null} onQuery={setQuery} onCity={chooseCity} />

        {error && <Alert>{error}</Alert>}

        <Results clubs={clubs} city={city ?? null} query={query.trim()} />

        {session.status === 'ready' && (
          <>
            <MyEntries />
            <MyClubs />
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
  query,
  cityId,
  onQuery,
  onCity,
}: {
  query: string;
  cityId: string | null;
  onQuery: (value: string) => void;
  onCity: (city: City | null) => void;
}) {
  return (
    <section className="relative mt-6 mb-12 rounded-card bg-brand-900 px-6 py-10 text-white sm:mt-8 sm:px-10 sm:py-14">
      {/* Обрезка — у слоя с рекой, а не у всего баннера: подсказки города
          выпадают за его нижний край, и overflow-hidden на секции их резал. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-card" aria-hidden="true">
        <RiverBackdrop orientation="landscape" />
      </div>

      <div className="relative z-10">
        <h1 className="max-w-2xl text-[1.875rem] leading-[1.1] text-white sm:text-[2.625rem]">
          Найдите зал, где играют рядом с вами
        </h1>

        <p className="mt-4 max-w-lg text-[1rem] leading-relaxed text-brand-100">
          Клубы настольного тенниса, их тренировки, турниры и свободные столы — один аккаунт на все.
        </p>

        <div className="mt-8 grid max-w-3xl gap-3 sm:grid-cols-[1fr_16rem]">
          <label className="relative block">
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
            placeholder="Город"
            inputClassName="h-14 border-transparent text-[1.0625rem]"
          />
        </div>
      </div>
    </section>
  );
}

/**
 * Клубы выбранного города: строки табло, а не сетка карточек.
 *
 * Город совпадает, если это город клуба ИЛИ хотя бы одного его зала — правило
 * поиска на сервере, заголовок его не пересказывает, а просто называет город.
 */
function Results({ clubs, city, query }: { clubs: ClubCard[] | null; city: City | null; query: string }) {
  // «в городе Красноярск», а не «в Красноярске»: склонять тысячу названий
  // справочника нечем, а неверный падеж хуже честного «в городе».
  const title = query
    ? `Клубы по запросу «${query}»${city ? ` в городе ${city.name}` : ''}`
    : city
      ? `Где играть в городе ${city.name}`
      : 'Все клубы платформы';

  return (
    <section>
      <SectionTitle>{title}</SectionTitle>

      {clubs === null && <ResultsSkeleton />}

      {clubs?.length === 0 && (
        <div className="border-t border-border py-12">
          <p className="text-[1.0625rem] text-text">
            {city ? `В городе ${city.name} клубов пока нет` : 'Ничего не нашлось'}
          </p>
          <p className="mt-2 max-w-md text-[0.9375rem] leading-relaxed text-text-muted">
            {query
              ? 'Попробуйте другое написание названия или выберите «Любой город».'
              : 'Платформа только открывается. Клубы появятся здесь, как только подключатся.'}
          </p>
        </div>
      )}

      {clubs && clubs.length > 0 && (
        <ul className="border-t border-border">
          {clubs.map((club) => (
            <li key={club.slug}>
              <ClubRow club={club} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Одна строка выдачи.
 *
 * Фирменный цвет клуба вынесен в вертикальную полосу слева. Красить в него
 * текст или фон строки нельзя: цвета клубов произвольны, и контраст на светлом
 * и тёмном фоне не гарантирован ни одним из них. Полоса же читается как метка
 * при любом цвете и ничего не делает нечитаемым.
 */
function ClubRow({ club }: { club: ClubCard }) {
  const places = [club.city, ...club.otherCities].filter(Boolean).join(', ');

  return (
    <Link
      href={`/clubs/${club.slug}`}
      className={cn(
        'group relative flex items-center gap-4 border-b border-border py-5 pl-4 sm:gap-6 sm:pl-6',
        'transition-colors hover:bg-surface-sunken',
      )}
    >
      <span
        aria-hidden="true"
        className="absolute top-4 bottom-4 left-0 w-[3px] rounded-full transition-[top,bottom] group-hover:top-2 group-hover:bottom-2"
        style={{ background: club.accentColor ?? 'var(--accent)' }}
      />

      <ClubMark club={club} />

      <span className="min-w-0 grow">
        <span className="block truncate text-[1.0625rem] text-text">{club.name}</span>
        <span className="mt-0.5 block truncate text-[0.875rem] text-text-muted">
          {places || 'Город не указан'}
        </span>
      </span>

      <span className="hidden shrink-0 text-[0.875rem] text-text-subtle sm:block">
        {hallsLabel(club.hallCount)}
      </span>

      <ArrowIcon />
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

  return (
    <section className="mt-16">
      <SectionTitle
        action={
          <Link href="/my-bookings">
            <Button variant="secondary" size="sm">
              Подробнее
            </Button>
          </Link>
        }
      >
        Мои записи
      </SectionTitle>

      {entries === null && <ResultsSkeleton rows={2} />}

      {entries !== null && upcoming.length === 0 && (
        <p className="border-t border-border py-6 text-[0.9375rem] text-text-muted">
          Предстоящих записей нет. Выберите клуб выше — и запишитесь на занятие или турнир.
        </p>
      )}

      {upcoming.length > 0 && (
        <ul className="border-t border-border">
          {upcoming.slice(0, 3).map((entry) => (
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
        <p className="mt-3 text-[0.8125rem] text-text-subtle">
          И ещё {upcoming.length - 3} — в разделе «Мои записи».
        </p>
      )}
    </section>
  );
}

/** Мои клубы — плитками: их не больше трёх, и каждую открывают, а не читают. */
function MyClubs() {
  const [clubs, setClubs] = useState<FavouriteClub[] | null>(null);

  useEffect(() => {
    api
      .myClubs()
      .then(setClubs)
      .catch(() => setClubs([]));
  }, []);

  return (
    <section className="mt-16">
      <SectionTitle>Мои клубы</SectionTitle>

      {clubs !== null && clubs.length === 0 && (
        <p className="border-t border-border py-6 text-[0.9375rem] text-text-muted">
          Своих клубов пока нет. Отметьте клуб сердечком на его странице — он появится здесь.
        </p>
      )}

      {clubs && clubs.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-3">
          {clubs.map((club) => (
            <li key={club.slug}>
              <Link
                href={`/clubs/${club.slug}`}
                className={cn(
                  'group relative flex h-full items-center gap-4 overflow-hidden rounded-card border border-border',
                  'bg-surface-raised px-5 py-4 transition-colors hover:border-border-strong',
                )}
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-[3px]"
                  style={{ background: club.accentColor ?? 'var(--accent)' }}
                />
                <ClubMark club={club} />
                <span className="min-w-0 grow">
                  <span className="block truncate text-[1rem] text-text">{club.name}</span>
                  <span className="block truncate text-[0.8125rem] text-text-muted">
                    {club.city ?? 'Город не указан'}
                  </span>
                </span>
                <ArrowIcon />
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
    <section className="mt-16">
      <SectionTitle>Ближайшее в моих клубах</SectionTitle>

      {events === null && <ResultsSkeleton rows={2} />}

      {events && (
        <ul className="border-t border-border">
          {events.map((event) => (
            <li key={`${event.club.slug}-${event.kind}-${event.id}`}>
              <button
                type="button"
                onClick={() => setOpen(event)}
                className={cn(
                  'group flex w-full flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border py-4 pl-4 text-left sm:pl-6',
                  'transition-colors hover:bg-surface-sunken',
                )}
              >
                <When instant={event.startsAt} />

                <span className="min-w-0 grow">
                  <span className="block text-[0.9375rem] text-text group-hover:underline">{event.title}</span>
                  <span className="block text-[0.8125rem] text-text-muted">
                    {event.club.name}
                    {event.subtitle && ` · ${event.subtitle}`}
                  </span>
                </span>

                <span className="text-[0.875rem] whitespace-nowrap text-text">{formatKopecks(event.price)}</span>
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
    <section className="mt-16">
      <SectionTitle
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

      <ul className="border-t border-border">
        {items.map((item) => (
          <NewsRow key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-[1.375rem]">{children}</h2>
      {action}
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

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-text-subtle"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="6" />
      <path d="m13.5 13.5 3.5 3.5" />
    </svg>
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
