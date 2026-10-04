'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FavouriteCoach } from '@yenisey/types';
import { PlayerAvatar } from '@/components/player/PlayerView';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { api, ApiError } from '@/lib/api';

/**
 * Мои тренеры — весь список (решение владельца от 02.10.2026). Стартовая
 * показывает первых шесть, здесь — все и снятие отметки. Отмечают тренера
 * сердечком на его странице или на его карточке в клубе.
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
        description="Тренеры, которых вы отметили сердечком. Их ближайшие занятия — на стартовой странице."
      />
      <CardBody>
        {error && <Alert>{error}</Alert>}

        {coaches === null && !error && <p className="text-[0.875rem] text-text-muted">Загружаю…</p>}

        {coaches?.length === 0 && (
          <p className="text-[0.875rem] text-text-muted">
            Пока ни одного. Отметьте тренера сердечком на его странице или на его карточке во вкладке «Тренеры»
            клуба.
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
      </CardBody>
    </Card>
  );
}
