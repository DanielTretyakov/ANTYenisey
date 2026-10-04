'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { FavouriteCoach } from '@yenisey/types';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { loginHref } from '@/lib/next';

/**
 * Сердечко «в мои тренеры» (решение владельца от 02.10.2026) — тем же видом,
 * что у клуба на обложке: красная заливка — в избранном, контур — нет. Слова
 * — в подсказке и для диктора.
 *
 * Гостя ведёт на вход с возвратом сюда же. `favourite === null` — ещё не
 * знаем, отмечен ли: кнопка ждёт, а не врёт контуром.
 */
export function CoachHeart({
  coachId,
  favourite,
  anonymous,
  onChange,
  size = 'lg',
  className,
}: {
  coachId: string;
  favourite: boolean | null;
  anonymous: boolean;
  /** Сервер вернул список целиком — по нему и решается, отмечен ли. */
  onChange: (coaches: FavouriteCoach[]) => void;
  size?: 'lg' | 'sm';
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = favourite === true;
  const label = active ? 'Убрать из моих тренеров' : 'В мои тренеры';

  async function toggle(): Promise<void> {
    setPending(true);
    setError(null);

    try {
      onChange(active ? await api.removeCoach(coachId) : await api.addCoach(coachId));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(false);
    }
  }

  const heart = (
    <svg viewBox="0 0 24 24" className={size === 'lg' ? 'h-6 w-6' : 'h-5 w-5'} aria-hidden="true">
      <path
        d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"
        fill={active ? '#e5484d' : 'none'}
        stroke={active ? '#e5484d' : 'currentColor'}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );

  const buttonClass = cn(
    'grid shrink-0 place-items-center rounded-full border border-border bg-surface-raised text-text-muted',
    'transition-transform hover:scale-105 hover:text-text disabled:opacity-60',
    size === 'lg' ? 'h-12 w-12' : 'h-9 w-9',
  );

  return (
    <div className={cn('flex flex-col items-end gap-2', className)}>
      {anonymous ? (
        <Link href={loginHref()} title="Войти, чтобы отметить тренера" aria-label="Войти, чтобы отметить тренера" className={buttonClass}>
          {heart}
        </Link>
      ) : (
        <button
          type="button"
          aria-pressed={active}
          title={label}
          aria-label={label}
          disabled={pending || favourite === null}
          onClick={() => void toggle()}
          className={buttonClass}
        >
          {heart}
        </button>
      )}

      {error && (
        <p className="max-w-xs rounded-control bg-surface-sunken px-3 py-2 text-right text-[0.8125rem] text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
