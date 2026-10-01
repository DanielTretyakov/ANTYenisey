'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ClubRating, ClubRatingRow, Gender, RatingPeriod } from '@yenisey/types';
import { PlayerAvatar } from '@/components/player/PlayerView';
import { Button } from '@/components/ui/Button';
import { Tab } from '@/components/ui/Tab';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { plural } from '@/lib/plural';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { SectionHeading } from './SectionHeading';

const PERIODS: { value: RatingPeriod; label: string }[] = [
  { value: 'month', label: 'Этот месяц' },
  { value: 'year', label: 'Этот год' },
  { value: 'all', label: 'Всё время' },
];

const GENDERS: { value: Gender | null; label: string }[] = [
  { value: null, label: 'Все' },
  { value: 'MALE', label: 'Мужчины' },
  { value: 'FEMALE', label: 'Женщины' },
];

/**
 * Сколько мест в колонке (решение владельца от 01.10.2026): пьедестал первых
 * трёх и строками 4-е и 5-е, всё остальное — на странице «Подробнее».
 * Прежние десять строк делали колонку башней.
 */
export const RATING_SHOWN = 5;

/** Якорь колонки. */
export const RATING_ANCHOR = 'reiting';

/**
 * Рейтинг посещений (решения владельца от 26 и 27.09.2026): кто чаще всех
 * ходит в клуб. Общий для всех залов блок — правая колонка над выбором зала.
 * Визит — отмеченный «пришёл», не больше одного в день; месяц и год —
 * календарные. Человек — как в окне мероприятия: младше 14 — без ссылки и
 * фото. Вошедший видит своё место; скрыться из рейтингов и отобрать по полу —
 * в окне «Подробнее».
 */
export function ClubRatingColumn() {
  const slug = useClubSlug();
  const [period, setPeriod] = useState<RatingPeriod>('month');
  const { rating, error } = useRating(period, null);

  const rows = rating?.rows.slice(0, RATING_SHOWN) ?? [];
  const mineShown = rating?.me && rows.some((row) => sameRow(row, rating.me!));

  return (
    <section
      id={RATING_ANCHOR}
      className="flex min-w-0 scroll-mt-40 flex-col rounded-card border border-border bg-surface-raised"
    >
      <header className="px-5 pt-4 pb-3">
        <SectionHeading
          className="mb-3"
          title="Рейтинг посещений"
          description="Кто чаще всех приходит в клуб. Весь рейтинг — в «Подробнее»."
        />
        <PeriodTabs value={period} onChange={setPeriod} />
      </header>

      {/* Пьедестал всегда на виду (решение от 01.10.2026): свободное место —
          заглушкой, а не пустотой, — пьедестал и есть то, ради чего блок. */}
      <div className="flex-1">
        {error ? (
          <p className="px-5 py-4 text-[0.9375rem] text-danger">{error}</p>
        ) : (
          <>
            <Podium rows={rows.slice(0, 3)} me={rating?.me ?? null} loading={rating === null} />
            <ol className="divide-y divide-border" start={4}>
              {[3, 4].map((index) => {
                const row = rows[index];

                return row ? (
                  <RatingRow
                    key={`${row.place}-${row.name}-${index}`}
                    row={row}
                    mine={rating?.me != null && sameRow(row, rating.me)}
                  />
                ) : (
                  // Пустое место — строкой-заглушкой той же высоты: плитка не
                  // прыгает от того, сколько людей набралось за период.
                  <li key={index} className="flex h-14 items-center gap-4 px-5 text-text-subtle">
                    <span className="w-8 shrink-0 text-right font-display text-[1.125rem] tabular-nums">{index + 1}</span>
                    <span className="text-[0.875rem]">{rating === null ? '…' : 'место свободно'}</span>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>

      <footer className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-5 py-3">
        <Link href={`/clubs/${slug}/rating?period=${period}`}>
          <Button variant="secondary" size="sm">
            Подробнее
          </Button>
        </Link>
        {rating?.me && !mineShown && (
          <span className="text-[0.875rem] text-text-muted">
            Ваше место — <span className="text-text">{rating.me.place}</span>, {rating.me.visits}{' '}
            {plural(rating.me.visits, 'визит', 'визита', 'визитов')}
          </span>
        )}
      </footer>
    </section>
  );
}

/**
 * Весь рейтинг — до полусотни строк — с фильтром по полу и выключателем «не
 * показывать меня». Страницей `/clubs/:slug/rating` (решение владельца от
 * 30.09.2026), а не окном; период — тот, что был выбран в колонке.
 */
export function RatingFull({ initialPeriod }: { initialPeriod: RatingPeriod }) {
  const [period, setPeriod] = useState(initialPeriod);
  const [gender, setGender] = useState<Gender | null>(null);
  const [version, setVersion] = useState(0);
  const { rating, error } = useRating(period, gender, version);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function toggleHidden(hidden: boolean): Promise<void> {
    setSaving(true);
    setSaveError(null);

    try {
      await api.setRatingHidden(hidden);
      setVersion((value) => value + 1);
    } catch (cause) {
      setSaveError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setSaving(false);
    }
  }

  const mineShown = rating?.me && rating.rows.some((row) => sameRow(row, rating.me!));

  return (
    <div className="max-w-3xl">
      <div>
        <div className="mb-2">
          <PeriodTabs value={period} onChange={setPeriod} />
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Пол">
          {GENDERS.map((item) => (
            <Tab key={item.label} active={gender === item.value} onClick={() => setGender(item.value)}>
              {item.label}
            </Tab>
          ))}
        </div>
        {gender && (
          <p className="mb-3 text-[0.8125rem] text-text-subtle">
            Игроки младше 14 лет в отборе по полу не участвуют — их пол открытые списки не показывают.
          </p>
        )}

        {(error || saveError) && <p className="mb-3 text-[0.9375rem] text-danger">{error ?? saveError}</p>}

        {rating === null ? (
          <p className="text-[0.9375rem] text-text-muted" aria-busy="true">
            Загружаю…
          </p>
        ) : rating.rows.length === 0 ? (
          <p className="text-[0.9375rem] text-text-muted">Отмеченных визитов за этот период нет.</p>
        ) : (
          <ol className="divide-y divide-border rounded-card border border-border bg-surface-raised">
            {rating.rows.map((row, index) => (
              <RatingRow
                key={`${row.place}-${row.name}-${index}`}
                row={row}
                mine={rating.me !== null && sameRow(row, rating.me)}
              />
            ))}
            {rating.me && !mineShown && (
              <>
                <li className="px-5 py-1 text-center text-text-subtle" aria-hidden="true">
                  ⋯
                </li>
                <RatingRow row={rating.me} mine />
              </>
            )}
          </ol>
        )}

        {rating?.meHidden !== null && rating?.meHidden !== undefined && (
          <label className="mt-4 flex items-center gap-2 text-[0.875rem] text-text-muted">
            <input
              type="checkbox"
              checked={rating.meHidden}
              disabled={saving}
              onChange={(event) => void toggleHidden(event.target.checked)}
            />
            Не показывать меня в рейтингах клубов
          </label>
        )}
      </div>
    </div>
  );
}

function useRating(period: RatingPeriod, gender: Gender | null, version = 0) {
  const club = useClubApi();
  const [rating, setRating] = useState<ClubRating | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRating(null);
    setError(null);

    club
      .rating(period, gender)
      .then((loaded) => {
        if (!cancelled) setRating(loaded);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
      });

    return () => {
      cancelled = true;
    };
  }, [club, period, gender, version]);

  return { rating, error };
}

function PeriodTabs({ value, onChange }: { value: RatingPeriod; onChange: (period: RatingPeriod) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Период">
      {PERIODS.map((item) => (
        <Tab key={item.value} active={value === item.value} onClick={() => onChange(item.value)}>
          {item.label}
        </Tab>
      ))}
    </div>
  );
}

/**
 * Пьедестал первых трёх: второй — слева, первый — в центре и выше, третий —
 * справа. Те же люди и те же правила, что в строках: у младше 14 нет ни
 * ссылки, ни фото. Своё место подсвечено.
 */
function Podium({ rows, me, loading }: { rows: ClubRatingRow[]; me: ClubRatingRow | null; loading: boolean }) {
  // Второй — слева, первый — в центре, третий — справа; пустое место — null.
  const order = [rows[1] ?? null, rows[0] ?? null, rows[2] ?? null];
  const places = [2, 1, 3];
  const height = ['h-14', 'h-20', 'h-10'];

  return (
    <ol
      className="flex h-[14rem] items-end justify-center gap-3 border-b border-border px-5"
      aria-label="Первые три места"
      aria-busy={loading}
    >
      {order.map((row, index) => {
        const mine = row !== null && me !== null && sameRow(row, me);
        const person = row ? (
          <span className="flex flex-col items-center gap-0.5">
            <span className={cn('rounded-full', mine && 'ring-2 ring-accent')}>
              <PlayerAvatar fileId={row.avatarFileId} name={row.name} gender={row.gender} size={index === 1 ? 'sm' : 'xs'} />
            </span>
            <span className="max-w-full truncate text-[0.8125rem] leading-tight text-text">{row.name}</span>
            <span className="text-[0.75rem] leading-tight text-text-muted tabular-nums">
              {row.visits} {plural(row.visits, 'визит', 'визита', 'визитов')}
            </span>
          </span>
        ) : (
          <span className="flex flex-col items-center gap-0.5">
            <span
              aria-hidden="true"
              className={cn(
                'grid place-items-center rounded-full border border-dashed border-border-strong text-text-subtle',
                index === 1 ? 'h-12 w-12' : 'h-10 w-10',
              )}
            >
              ?
            </span>
            <span className="text-[0.8125rem] leading-tight text-text-subtle">{loading ? '…' : 'место свободно'}</span>
            <span className="text-[0.75rem] leading-tight text-transparent" aria-hidden="true">
              —
            </span>
          </span>
        );

        return (
          <li
            key={places[index]}
            className="flex max-w-[7.5rem] min-w-0 flex-1 flex-col items-center gap-1.5"
          >
            {row?.userId ? (
              <Link href={`/players/${row.userId}`} className="max-w-full hover:underline">
                {person}
              </Link>
            ) : (
              person
            )}
            <span
              className={cn(
                'grid w-full place-items-center rounded-t-[0.625rem] font-display',
                height[index],
                index === 1
                  ? 'bg-accent text-[1.5rem] text-accent-text'
                  : 'bg-surface-accent-soft text-[1.125rem] text-text-accent',
                !row && 'opacity-50',
              )}
            >
              {row?.place ?? places[index]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Строка смотрящего — по месту и имени: у ребёнка в строке нет `userId`. */
function sameRow(a: ClubRatingRow, b: ClubRatingRow): boolean {
  return a.place === b.place && a.name === b.name && a.visits === b.visits;
}

/** Строка рейтинга — фиксированной высоты: по ней считается высота блока. */
function RatingRow({ row, mine = false }: { row: ClubRatingRow; mine?: boolean }) {
  const person = (
    <span className="flex min-w-0 items-center gap-3">
      <PlayerAvatar fileId={row.avatarFileId} name={row.name} gender={row.gender} size="xs" />
      <span className="truncate text-[0.9375rem] text-text">{row.name}</span>
    </span>
  );

  return (
    <li className={cn('flex h-14 items-center gap-4 px-5', mine && 'bg-surface-accent-soft')}>
      <span
        className={cn(
          'w-8 shrink-0 text-right font-display text-[1.125rem] tabular-nums',
          row.place <= 3 ? 'text-text-accent' : 'text-text-subtle',
        )}
      >
        {row.place}
      </span>
      <span className="min-w-0 flex-1">
        {row.userId ? (
          <Link href={`/players/${row.userId}`} className="hover:underline">
            {person}
          </Link>
        ) : (
          person
        )}
      </span>
      <span className="shrink-0 text-[0.875rem] text-text-muted tabular-nums">
        {row.visits} {plural(row.visits, 'визит', 'визита', 'визитов')}
      </span>
    </li>
  );
}
