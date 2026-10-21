'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { PlayerSearchPage, PlayerSearchRow, PlayerSearchSort, RatingSystem } from '@yenisey/types';
import { RATING_SYSTEM_LABEL } from '@yenisey/types';
import { AppShell } from '@/components/layout/AppShell';
import { PlayerAvatar } from '@/components/player/PlayerView';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { inputClassName } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/useSession';

/** Колонки рейтингов — в порядке, который назвал владелец: ФНТР, RTTW, RTTF. */
const SYSTEMS: RatingSystem[] = ['FNTR', 'RTTW', 'RTTF'];

const LOGOS: Record<RatingSystem, { src: string; className: string }> = {
  FNTR: { src: '/brand/ratings/fntr.png', className: 'h-3 w-auto' },
  RTTW: { src: '/brand/ratings/rttw.svg', className: 'h-3.5 w-3.5' },
  RTTF: { src: '/brand/ratings/rttf.svg', className: 'h-5 w-auto' },
};

/**
 * «Найти игрока» — глобальный поиск игроков и тренеров с рейтингами (решения
 * владельца от 20.10.2026): «Фамилия Имя», год рождения, клуб, где чаще всего
 * бывал за год, и рейтинги ФНТР, RTTW, RTTF. В выдаче — все с 14 лет, кроме
 * поставивших «не показывать меня в рейтингах»; детей нет вовсе — решает
 * сервер.
 *
 * Запрос живёт в адресе (`?q=`, `?sort=`): найденного можно переслать
 * ссылкой. Читается он из `window.location` в эффекте — без
 * `useSearchParams` и границ Suspense, как выбор «за кого».
 */
export default function FindPlayerPage() {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<PlayerSearchSort>('name');
  const [page, setPage] = useState<PlayerSearchPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [ready, setReady] = useState(false);
  /** Скрылся или вернулся в поиск — выдачу перечитать. */
  const [refresh, setRefresh] = useState(0);
  const request = useRef(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('sort');

    setQuery(params.get('q') ?? '');
    if (fromUrl === 'FNTR' || fromUrl === 'RTTW' || fromUrl === 'RTTF') setSort(fromUrl);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;

    const id = ++request.current;
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (sort !== 'name') params.set('sort', sort);
      window.history.replaceState(null, '', `/players${params.size ? `?${params}` : ''}`);

      setError(null);
      api
        .searchPlayers({ query, sort })
        .then((found) => {
          if (request.current === id) setPage(found);
        })
        .catch((cause: unknown) => {
          if (request.current === id) setError(cause instanceof ApiError ? cause.message : 'Нет связи. Проверьте интернет и попробуйте ещё раз');
        });
    }, 300);

    return () => clearTimeout(timer);
  }, [query, sort, ready, refresh]);

  async function loadMore(): Promise<void> {
    if (!page) return;

    setLoadingMore(true);

    try {
      const next = await api.searchPlayers({ query, sort, offset: page.rows.length });
      setPage({ total: next.total, rows: [...page.rows, ...next.rows] });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Нет связи. Проверьте интернет и попробуйте ещё раз');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <AppShell>
      <header className="mb-6">
        <h1 className="text-[2rem] leading-tight">Найти игрока</h1>
        <p className="mt-2 max-w-2xl text-[0.9375rem] text-text-muted">
          Игроки и тренеры всех клубов платформы с рейтингами ФНТР, RTTW и RTTF. Ищите по фамилии, имени и году
          рождения — например, «Иванов Пётр 1990».
        </p>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <label className="min-w-0 grow sm:max-w-md">
          <span className="sr-only">Фамилия, имя, год рождения</span>
          <input
            type="search"
            name="q"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Фамилия, имя, год рождения"
            className={inputClassName}
            autoFocus
          />
        </label>
        {page && (
          <p className="text-[0.875rem] text-text-muted" aria-live="polite">
            {page.total === 0 ? 'Никого не нашлось' : `Найдено: ${page.total}`}
          </p>
        )}
      </div>

      {/* На телефоне — порядок списком: столбцов, по которым щёлкать, там нет. */}
      <div className="mb-4 flex flex-wrap gap-1.5 md:hidden" role="group" aria-label="Порядок">
        {(['name', ...SYSTEMS] as PlayerSearchSort[]).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={sort === value}
            onClick={() => setSort(value)}
            className={cn(
              'h-8 rounded-full border px-3 text-[0.8125rem] transition-colors',
              sort === value ? 'border-accent bg-surface-accent-soft text-text-accent' : 'border-border text-text-muted hover:text-text',
            )}
          >
            {value === 'name' ? 'По фамилии' : RATING_SYSTEM_LABEL[value]}
          </button>
        ))}
      </div>

      {error && <Alert>{error}</Alert>}

      {!page && !error && <SearchSkeleton />}

      {page && page.rows.length > 0 && (
        <>
          <PlayersTable rows={page.rows} sort={sort} onSort={setSort} />
          <PlayersCards rows={page.rows} />

          {page.rows.length < page.total && (
            <div className="mt-6 flex justify-center">
              <Button variant="secondary" pending={loadingMore} onClick={() => void loadMore()}>
                Показать ещё
              </Button>
            </div>
          )}
        </>
      )}

      {page && page.rows.length === 0 && (
        <p className="rounded-card border border-dashed border-border px-5 py-8 text-center text-[0.9375rem] text-text-muted">
          {query.trim()
            ? 'Никого не нашлось — проверьте написание или уберите год рождения.'
            : 'Пока здесь никого нет.'}
        </p>
      )}

      <footer className="mt-8 grid max-w-2xl gap-3 text-[0.8125rem] text-text-subtle">
        <p>Игроков младше 14 лет в поиске нет. Рейтинги сайт находит сам раз в сутки.</p>
        <HideMyself onChanged={() => setRefresh((value) => value + 1)} />
      </footer>
    </AppShell>
  );
}

/**
 * Скрыться из поиска — тем же флажком, что из рейтинга посещений клубов
 * (решение владельца от 20.10.2026: одна галочка на оба места). Только
 * вошедшему.
 */
function HideMyself({ onChanged }: { onChanged: () => void }) {
  const session = useSession();
  const [hidden, setHidden] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const signedIn = session.status === 'ready';

  useEffect(() => {
    if (!signedIn) return;

    api
      .ratingHidden()
      .then((value) => setHidden(value.hidden))
      .catch(() => undefined);
  }, [signedIn]);

  if (!signedIn || hidden === null) return null;

  async function toggle(next: boolean): Promise<void> {
    setPending(true);

    try {
      setHidden((await api.setRatingHidden(next)).hidden);
      onChanged();
    } finally {
      setPending(false);
    }
  }

  return (
    <label className="flex items-center gap-2 text-[0.875rem] text-text-muted">
      <input type="checkbox" checked={hidden} disabled={pending} onChange={(event) => void toggle(event.target.checked)} />
      Не показывать меня в поиске игроков и рейтингах клубов
    </label>
  );
}

/** Компьютер: таблица, по рейтингу сортирует щелчок по заголовку столбца. */
function PlayersTable({
  rows,
  sort,
  onSort,
}: {
  rows: PlayerSearchRow[];
  sort: PlayerSearchSort;
  onSort: (sort: PlayerSearchSort) => void;
}) {
  return (
    <div className="hidden overflow-hidden rounded-card border border-border bg-surface-raised md:block">
      <table className="w-full text-left">
        <thead className="border-b border-border bg-surface-sunken text-[0.75rem] tracking-[0.06em] text-text-subtle uppercase">
          <tr>
            <th scope="col" className="px-4 py-3 font-normal">
              <SortButton active={sort === 'name'} onClick={() => onSort('name')}>
                Игрок
              </SortButton>
            </th>
            <th scope="col" className="px-3 py-3 font-normal">
              Год
            </th>
            <th scope="col" className="px-3 py-3 font-normal">
              Клуб года
            </th>
            {SYSTEMS.map((system) => (
              <th key={system} scope="col" className="w-28 px-3 py-3 text-right font-normal">
                <SortButton active={sort === system} onClick={() => onSort(system)} align="right">
                  <RatingLogo system={system} />
                </SortButton>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.id} className="transition-colors hover:bg-surface-sunken/60">
              <td className="px-4 py-2.5">
                <PlayerName row={row} />
              </td>
              <td className="px-3 py-2.5 text-[0.9375rem] text-text-muted tabular-nums">{row.birthYear ?? '—'}</td>
              <td className="px-3 py-2.5">
                <ClubCell club={row.topClub} />
              </td>
              {SYSTEMS.map((system) => (
                <td
                  key={system}
                  className={cn(
                    'px-3 py-2.5 text-right font-display text-[1rem] tabular-nums',
                    row.ratings[system] === null ? 'text-text-subtle' : 'text-text',
                    sort === system && 'bg-surface-accent-soft/40',
                  )}
                >
                  {row.ratings[system] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Телефон: карточка на человека, рейтинги — тремя плашками в строку. */
function PlayersCards({ rows }: { rows: PlayerSearchRow[] }) {
  return (
    <ul className="grid gap-3 md:hidden">
      {rows.map((row) => (
        <li key={row.id} className="rounded-card border border-border bg-surface-raised p-4">
          <PlayerName row={row} />
          <p className="mt-2 text-[0.8125rem] text-text-muted">
            {row.birthYear ? `${row.birthYear} г. р.` : 'Год рождения не указан'}
            {row.topClub && (
              <>
                {' · '}
                <Link href={`/clubs/${row.topClub.slug}`} className="text-text-accent underline-offset-2 hover:underline">
                  {row.topClub.name}
                </Link>
              </>
            )}
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {SYSTEMS.map((system) => (
              <span key={system} className="flex flex-col items-center gap-1 rounded-control border border-border px-2 py-1.5">
                <RatingLogo system={system} />
                <span className={cn('font-display text-[1rem] tabular-nums', row.ratings[system] === null ? 'text-text-subtle' : 'text-text')}>
                  {row.ratings[system] ?? '—'}
                </span>
              </span>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Знак системы на светлой подложке; у RTTW значок без надписи — название словом. */
function RatingLogo({ system }: { system: RatingSystem }) {
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded bg-white px-1.5 normal-case">
      <img src={LOGOS[system].src} alt={system === 'RTTW' ? '' : RATING_SYSTEM_LABEL[system]} className={LOGOS[system].className} />
      {system === 'RTTW' && <span className="text-[0.6875rem] font-semibold tracking-wide text-[#2C3541]">RTTW</span>}
    </span>
  );
}

function PlayerName({ row }: { row: PlayerSearchRow }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <PlayerAvatar fileId={row.avatarFileId} name={row.name} gender={row.gender} size="xs" />
      <span className="min-w-0">
        <Link href={`/players/${row.id}`} className="block truncate text-[0.9375rem] text-text underline-offset-2 hover:underline">
          {row.name}
        </Link>
        {row.isCoach && (
          <Link
            href={`/coaches/${row.id}`}
            className="mt-0.5 inline-flex rounded-full bg-surface-accent-soft px-2 py-0.5 text-[0.6875rem] font-semibold text-text-accent"
          >
            тренер
          </Link>
        )}
      </span>
    </span>
  );
}

function ClubCell({ club }: { club: PlayerSearchRow['topClub'] }) {
  if (!club) return <span className="text-[0.875rem] text-text-subtle">—</span>;

  return (
    <Link href={`/clubs/${club.slug}`} className="inline-flex max-w-[14rem] items-center gap-2 text-[0.875rem] text-text hover:underline">
      <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: club.accentColor ?? 'var(--color-accent)' }} />
      <span className="truncate">{club.name}</span>
    </Link>
  );
}

function SortButton({
  active,
  onClick,
  align = 'left',
  children,
}: {
  active: boolean;
  onClick: () => void;
  align?: 'left' | 'right';
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title="Упорядочить"
      className={cn(
        'inline-flex items-center gap-1 uppercase transition-colors hover:text-text',
        align === 'right' && 'justify-end',
        active ? 'text-text-accent' : 'text-text-subtle',
      )}
    >
      {children}
      <span aria-hidden="true" className={cn('text-[0.625rem]', !active && 'opacity-0')}>
        ▼
      </span>
    </button>
  );
}

function SearchSkeleton() {
  return (
    <div className="grid gap-2" aria-busy="true">
      {Array.from({ length: 6 }, (_, index) => (
        <span key={index} className="h-14 rounded-control bg-border/40" />
      ))}
    </div>
  );
}
