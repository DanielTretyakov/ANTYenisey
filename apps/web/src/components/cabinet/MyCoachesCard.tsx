'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CoachSearchItem, FavouriteCoach } from '@yenisey/types';
import { PlayerAvatar } from '@/components/player/PlayerView';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { inputClassName } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';

/**
 * Мои тренеры — весь список (решение владельца от 02.10.2026). Стартовая
 * показывает первых шесть, здесь — все, снятие отметки и поиск по фамилии.
 * Ещё отмечают сердечком на странице тренера и на его карточке в клубе.
 */
export function MyCoachesCard() {
  const [coaches, setCoaches] = useState<FavouriteCoach[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    api
      .myCoaches()
      .then(setCoaches)
      .catch((cause: unknown) => setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен'));
  }, []);

  async function add(id: string): Promise<void> {
    setPending(id);
    setError(null);

    try {
      setCoaches(await api.addCoach(id));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(null);
    }
  }

  async function remove(id: string): Promise<void> {
    setPending(id);
    setError(null);

    try {
      setCoaches(await api.removeCoach(id));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(null);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader
        title="Мои тренеры"
        description="Тренеры, за которыми вы следите. Их ближайшие занятия — на стартовой странице."
      />
      <CardBody>
        {error && <Alert>{error}</Alert>}

        {coaches === null && !error && <p className="text-[0.875rem] text-text-muted">Загружаем…</p>}

        {coaches?.length === 0 && (
          <p className="text-[0.875rem] text-text-muted">
            Пока ни одного. Найдите тренера ниже по фамилии или отметьте сердечком на его странице и во вкладке
            «Тренеры» клуба.
          </p>
        )}

        {coaches && coaches.length > 0 && (
          <ul className="grid gap-1">
            {coaches.map((coach) => (
              <li key={coach.id} className="flex items-center gap-3 rounded-control px-2 py-2">
                <Link href={`/coaches/${coach.id}`} className="group flex min-w-0 grow items-center gap-3">
                  <PlayerAvatar fileId={coach.photoFileId} name={coach.name} gender={coach.gender} size="xs" />
                  <span className="min-w-0">
                    <span className="block truncate text-[0.9375rem] text-text group-hover:underline">
                      {coach.name}
                    </span>
                    <span className="block truncate text-[0.8125rem] text-text-muted">
                      {coach.clubs.length > 0
                        ? coach.clubs.map((club) => club.name).join(', ')
                        : 'Сейчас не тренирует'}
                    </span>
                  </span>
                </Link>
                <Button
                  size="sm"
                  variant="ghost"
                  pending={pending === coach.id}
                  disabled={pending !== null}
                  onClick={() => void remove(coach.id)}
                >
                  Убрать
                </Button>
              </li>
            ))}
          </ul>
        )}

        {coaches !== null && (
          <FindCoach taken={coaches.map((coach) => coach.id)} pending={pending} onAdd={(id) => void add(id)} />
        )}
      </CardBody>
    </Card>
  );
}

/**
 * Поиск тренера по фамилии прямо в карточке (просьба владельца от
 * 20.10.2026). Ищет сервер среди тренеров открытых клубов, «ё» = «е»; от двух
 * букв — короче выдача была бы списком всех тренеров платформы.
 */
function FindCoach({
  taken,
  pending,
  onAdd,
}: {
  taken: string[];
  pending: string | null;
  onAdd: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<CoachSearchItem[] | null>(null);
  const ready = query.trim().length >= 2;

  useEffect(() => {
    if (!ready) {
      setFound(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .searchCoaches(query.trim())
        .then((coaches) => {
          if (!cancelled) setFound(coaches);
        })
        .catch(() => {
          if (!cancelled) setFound([]);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, ready]);

  return (
    <div className="mt-4">
      <label className="block">
        <span className="sr-only">Фамилия тренера</span>
        <input
          type="search"
          name="coach"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Найти тренера по фамилии"
          className={inputClassName}
        />
      </label>

      {ready && found === null && <p className="mt-3 text-[0.875rem] text-text-muted">Ищем…</p>}

      {found !== null && found.length === 0 && (
        <p className="mt-3 text-[0.875rem] text-text-muted">Никого не нашлось — попробуйте другое написание.</p>
      )}

      {found !== null && found.length > 0 && (
        <ul className="mt-3 divide-y divide-border rounded-control border border-border bg-surface-sunken px-3">
          {found.map((coach) => (
            <li key={coach.id} className="flex items-center gap-3 py-2.5">
              <Link href={`/coaches/${coach.id}`} className="group flex min-w-0 grow items-center gap-3">
                <PlayerAvatar fileId={coach.photoFileId} name={coach.name} gender={coach.gender} size="xs" />
                <span className="min-w-0">
                  <span className="block truncate text-[0.9375rem] text-text group-hover:underline">{coach.name}</span>
                  <span className="block truncate text-[0.8125rem] text-text-muted">
                    {coach.clubs.map((club) => club.name).join(', ')}
                  </span>
                </span>
              </Link>
              {taken.includes(coach.id) ? (
                <span className="shrink-0 text-[0.8125rem] text-text-subtle">Уже в списке</span>
              ) : (
                <Button size="sm" pending={pending === coach.id} disabled={pending !== null} onClick={() => onAdd(coach.id)}>
                  Добавить
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
