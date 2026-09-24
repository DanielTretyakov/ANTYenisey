'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Hall } from '@yenisey/types';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useClubApi } from '@/lib/useClubApi';

/**
 * Приоритетный зал сотрудника — первый на смене и в расписании (решение
 * владельца от 24.09.2026). Хранится на сервере, у пары «человек + клуб»:
 * администратор, работающий с телефона и со стойки, видит один и тот же зал.
 *
 * `ready` — выбор уже прочитан: до этого страница не выбирает зал сама, иначе
 * первый по имени мелькнул бы и сменился.
 */
export function usePreferredHall() {
  const club = useClubApi();
  const [preferredHallId, setPreferredHallId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    club
      .myPreferences()
      .then((preferences) => {
        if (!cancelled) setPreferredHallId(preferences.preferredHallId);
      })
      // Не прочитали — страница просто работает, как раньше: первый зал.
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [club]);

  const toggle = useCallback(
    async (hallId: string): Promise<void> => {
      const next = preferredHallId === hallId ? null : hallId;

      setPending(true);
      setError(null);

      try {
        setPreferredHallId((await club.setMyPreferences({ preferredHallId: next })).preferredHallId);
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
      } finally {
        setPending(false);
      }
    },
    [club, preferredHallId],
  );

  return { preferredHallId, ready, pending, error, toggle };
}

/** Залы с приоритетным первым; остальные — в порядке сервера (по имени). */
export function withPreferredFirst(halls: Hall[], preferredHallId: string | null): Hall[] {
  const preferred = halls.find((hall) => hall.id === preferredHallId);

  return preferred ? [preferred, ...halls.filter((hall) => hall !== preferred)] : halls;
}

/** Какой зал открыть: приоритетный, если он ещё есть, иначе первый. */
export function initialHallId(halls: Hall[], preferredHallId: string | null): string {
  return halls.some((hall) => hall.id === preferredHallId) ? preferredHallId! : (halls[0]?.id ?? '');
}

/** Звёздочка «мой основной зал» рядом с выбором зала. */
export function PreferredHallButton({
  hallId,
  preferredHallId,
  pending,
  onToggle,
}: {
  hallId: string;
  preferredHallId: string | null;
  pending: boolean;
  onToggle: (hallId: string) => void;
}) {
  const active = hallId !== '' && hallId === preferredHallId;

  return (
    <button
      type="button"
      onClick={() => onToggle(hallId)}
      disabled={pending || hallId === ''}
      aria-pressed={active}
      title={active ? 'Этот зал открывается первым — нажмите, чтобы снять' : 'Открывать этот зал первым'}
      className={cn(
        'flex items-center gap-1.5 rounded-control border px-3 py-2 text-[0.875rem] transition-colors disabled:opacity-60',
        active
          ? 'border-border-strong bg-surface-sunken text-text'
          : 'border-border text-text-muted hover:bg-surface-sunken hover:text-text',
      )}
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
        <path
          d="M10 2.5l2.3 4.7 5.2.8-3.8 3.6.9 5.1L10 14.3l-4.6 2.4.9-5.1L2.5 8l5.2-.8L10 2.5z"
          fill={active ? 'var(--ball)' : 'none'}
          stroke={active ? 'var(--ball)' : 'currentColor'}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
      {active ? 'Основной зал' : 'Сделать основным'}
    </button>
  );
}
