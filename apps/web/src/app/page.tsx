'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { City, ClubCard, FeedEvent } from '@yenisey/types';
import { ClubMark } from '@/components/club/ClubMark';
import { When } from '@/components/club/When';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { Alert } from '@/components/ui/Alert';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatKopecks } from '@/lib/money';
import { useSession } from '@/lib/useSession';

/**
 * Стартовая страница платформы.
 *
 * К клубу НЕ привязана (ТЗ → «Стартовая страница»). Раньше здесь стоял лендинг
 * «Енисея» с его миссией и тремя одинаковыми карточками услуг; на платформе,
 * которая обслуживает много клубов, это неверно по сути: человек приходит
 * сюда найти зал в своём городе, а не читать про один конкретный клуб.
 *
 * Поэтому поиск — не блок под первым экраном, а сам первый экран. Клубы
 * показаны строками, а не карточками: строку сканируют глазами сверху вниз, и
 * двадцать клубов города так читаются, а сеткой квадратов — нет.
 *
 * Фотографий залов здесь нет намеренно. Стоковый снимок чужого зала под
 * названием клуба — это ложь о клубе; различает их фирменный цвет и логотип,
 * то есть то, что клуб про себя заявил сам.
 */
export default function StartPage() {
  const session = useSession();

  const [cities, setCities] = useState<City[]>([]);
  const [query, setQuery] = useState('');
  const [cityId, setCityId] = useState('');

  const [clubs, setClubs] = useState<ClubCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .cities()
      .then(setCities)
      .catch(() => setCities([]));
  }, []);

  // Пауза перед запросом: без неё каждая буква названия — отдельный поход в
  // базу, и ответы возвращаются вперемешку. Тот же приём, что в поиске людей.
  useEffect(() => {
    let cancelled = false;

    const timer = setTimeout(() => {
      api
        .searchClubs({ query: query.trim() || undefined, cityId: cityId || undefined })
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
  }, [query, cityId]);

  const cityName = useMemo(
    () => cities.find((city) => city.id === cityId)?.name ?? null,
    [cities, cityId],
  );

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <SiteHeader sticky={false} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 sm:px-8">
        <Search
          query={query}
          cityId={cityId}
          cities={cities}
          onQuery={setQuery}
          onCity={setCityId}
        />

        {error && <Alert>{error}</Alert>}

        <Results clubs={clubs} cityName={cityName} query={query.trim()} />

        {session.status === 'ready' && <Feed />}
      </main>

      <footer className="mt-20 border-t border-border">
        <div className="mx-auto w-full max-w-6xl px-5 py-9 text-[0.8125rem] text-text-subtle sm:px-8">
          Платформа клубов настольного тенниса
        </div>
      </footer>
    </div>
  );
}

/**
 * Первый экран: заголовок и два поля поиска.
 *
 * Асимметричный, а не по центру: поля стоят на той же вертикали, что и
 * результаты под ними, и глаз идёт по одной линии от запроса к выдаче. По
 * центру заголовок с полями смотрелся бы как заставка, а не как инструмент.
 */
function Search({
  query,
  cityId,
  cities,
  onQuery,
  onCity,
}: {
  query: string;
  cityId: string;
  cities: City[];
  onQuery: (value: string) => void;
  onCity: (value: string) => void;
}) {
  return (
    <section className="pt-14 pb-12 sm:pt-20 sm:pb-16">
      <h1 className="max-w-2xl text-[2rem] leading-[1.08] sm:text-[2.75rem]">
        Найдите зал, где играют рядом с вами
      </h1>

      <p className="mt-5 max-w-md text-[1.0625rem] leading-relaxed text-text-muted">
        Клубы настольного тенниса, их тренировки, турниры и свободные столы.
      </p>

      <div className="mt-9 grid max-w-3xl gap-3 sm:grid-cols-[1fr_auto]">
        <label className="relative block">
          <span className="sr-only">Название клуба</span>
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Название клуба"
            className={cn(
              'h-14 w-full rounded-control border border-border-strong bg-surface pr-4 pl-12',
              'text-[1.0625rem] text-text placeholder:text-text-subtle',
              'transition-colors outline-none focus:border-border-accent',
            )}
          />
        </label>

        <label className="block">
          <span className="sr-only">Город</span>
          <select
            value={cityId}
            onChange={(event) => onCity(event.target.value)}
            className={cn(
              'h-14 w-full rounded-control border border-border-strong bg-surface px-4 sm:w-56',
              'text-[1.0625rem] text-text transition-colors outline-none focus:border-border-accent',
            )}
          >
            <option value="">Любой город</option>
            {cities.map((city) => (
              <option key={city.id} value={city.id}>
                {city.region ? `${city.name} (${city.region})` : city.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

/** Выдача поиска: строки табло, а не сетка карточек. */
function Results({
  clubs,
  cityName,
  query,
}: {
  clubs: ClubCard[] | null;
  cityName: string | null;
  query: string;
}) {
  if (clubs === null) {
    return <ResultsSkeleton />;
  }

  if (clubs.length === 0) {
    return (
      <section className="border-t border-border py-16">
        <p className="text-[1.0625rem] text-text">
          {cityName ? `В городе ${cityName} клубов пока нет` : 'Ничего не нашлось'}
        </p>
        <p className="mt-2 max-w-md text-[0.9375rem] leading-relaxed text-text-muted">
          {query
            ? 'Попробуйте другое написание названия или уберите фильтр по городу.'
            : 'Платформа только открывается. Клубы появятся здесь, как только подключатся.'}
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="sr-only">Клубы</h2>

      <ul className="border-t border-border">
        {clubs.map((club) => (
          <li key={club.slug}>
            <ClubRow club={club} />
          </li>
        ))}
      </ul>
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

/** Лента ближайших мероприятий моих клубов. Показывается только вошедшим. */
function Feed() {
  const [events, setEvents] = useState<FeedEvent[] | null>(null);

  useEffect(() => {
    api
      .feed()
      .then(setEvents)
      .catch(() => setEvents([]));
  }, []);

  if (events === null || events.length === 0) {
    return null;
  }

  return (
    <section className="mt-20">
      <h2 className="text-[1.375rem]">Ближайшее в моих клубах</h2>

      <ul className="mt-6 border-t border-border">
        {events.map((event) => (
          <li
            key={`${event.club.slug}-${event.id}`}
            className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border py-4"
          >
            <When instant={event.startsAt} />

            <span className="min-w-0 grow">
              <span className="block text-[0.9375rem] text-text">{event.title}</span>
              <Link
                href={`/clubs/${event.club.slug}`}
                className="text-[0.8125rem] text-text-muted underline-offset-2 hover:underline"
              >
                {event.club.name}
              </Link>
            </span>

            <span className="text-[0.875rem] whitespace-nowrap text-text-muted">
              {formatKopecks(event.price)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Заглушка выдачи.
 *
 * Полосы той же высоты и в том же ритме, что будущие строки: список не
 * подпрыгивает в момент ответа сервера. Тот же приём, что у скелета профиля.
 */
function ResultsSkeleton() {
  return (
    <div className="border-t border-border" aria-busy="true">
      {[0, 1, 2].map((row) => (
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
