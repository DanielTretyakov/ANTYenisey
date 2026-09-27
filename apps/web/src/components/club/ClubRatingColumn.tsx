'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ClubRating, ClubRatingRow, Gender, RatingPeriod } from '@yenisey/types';
import { PlayerAvatar } from '@/components/player/PlayerView';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Tab } from '@/components/ui/Tab';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { plural } from '@/lib/plural';
import { useClubApi } from '@/lib/useClubApi';

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
 * Сколько строк в колонке (решение владельца от 27.09.2026): высота блока —
 * десять человек, остальные — в окне «Подробнее». По этой высоте равняется
 * и соседняя колонка новостей.
 */
export const RATING_SHOWN = 10;

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
  const [period, setPeriod] = useState<RatingPeriod>('month');
  const { rating, error } = useRating(period, null);
  const [open, setOpen] = useState(false);

  const rows = rating?.rows.slice(0, RATING_SHOWN) ?? [];
  const mineShown = rating?.me && rows.some((row) => sameRow(row, rating.me!));

  return (
    <section
      id={RATING_ANCHOR}
      className="flex min-w-0 scroll-mt-24 flex-col rounded-card border border-border bg-surface-raised"
    >
      <header className="border-b border-border px-5 pt-4 pb-3">
        <h2 className="mb-3 text-[1.375rem]">Рейтинг посещений</h2>
        <PeriodTabs value={period} onChange={setPeriod} />
      </header>

      {/* Высота — ровно десять строк, сколько бы их ни было. */}
      <div className="h-[calc(35rem+9px)] overflow-hidden">
        {error ? (
          <p className="px-5 py-4 text-[0.9375rem] text-danger">{error}</p>
        ) : rating === null ? (
          <p className="px-5 py-4 text-[0.9375rem] text-text-muted" aria-busy="true">
            Загружаю…
          </p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-4 text-[0.9375rem] text-text-muted">За этот период отмеченных визитов пока нет.</p>
        ) : (
          <ol className="divide-y divide-border">
            {rows.map((row, index) => (
              <RatingRow
                key={`${row.place}-${row.name}-${index}`}
                row={row}
                mine={rating.me !== null && sameRow(row, rating.me)}
              />
            ))}
          </ol>
        )}
      </div>

      <footer className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-5 py-3">
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Подробнее
        </Button>
        {rating?.me && !mineShown && (
          <span className="text-[0.875rem] text-text-muted">
            Ваше место — <span className="text-text">{rating.me.place}</span>, {rating.me.visits}{' '}
            {plural(rating.me.visits, 'визит', 'визита', 'визитов')}
          </span>
        )}
      </footer>

      {open && <RatingDialog initialPeriod={period} onClose={() => setOpen(false)} />}
    </section>
  );
}

/**
 * Весь рейтинг — до полусотни строк — с фильтром по полу и выключателем «не
 * показывать меня».
 */
function RatingDialog({ initialPeriod, onClose }: { initialPeriod: RatingPeriod; onClose: () => void }) {
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
    <Dialog
      title="Рейтинг посещений"
      description="Дни в клубе: отмеченные визиты — занятия, турниры, аренда, спарринги, не больше одного в день."
      onClose={onClose}
      size="lg"
    >
      <div className="px-6 py-5">
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
          <ol className="divide-y divide-border rounded-card border border-border">
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
    </Dialog>
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
