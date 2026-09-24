'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { PublicPlayer } from '@yenisey/types';
import { AppShell } from '@/components/layout/AppShell';
import { PlayerPublicSkeleton, PlayerPublicView } from '@/components/player/PlayerPublicView';
import { Alert } from '@/components/ui/Alert';
import { api, ApiError } from '@/lib/api';

/**
 * Страница игрока — открыта всем, без входа.
 *
 * Расширение сверх ТЗ (решение владельца от 12.09.2026). Имя — «Фамилия И.»,
 * как в списках записавшихся; ни телефона, ни почты, ни даты рождения сервер
 * сюда не отдаёт вовсе.
 *
 * Игрока младше шестнадцати посторонний не найдёт: сервер отвечает 404, не
 * отличая «закрыто» от «нет такого». Сам игрок и администраторы его клубов
 * видят страницу с пометкой, что она скрыта.
 */
export default function PlayerPage() {
  const params = useParams<{ id: string }>();
  const [player, setPlayer] = useState<PublicPlayer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .player(params.id)
      .then(setPlayer)
      .catch((cause: unknown) =>
        setError(
          cause instanceof ApiError && cause.status === 404
            ? 'Игрок не найден или его страница закрыта.'
            : 'Не удалось связаться с сервером',
        ),
      );
  }, [params.id]);

  return (
    <AppShell>
      {error && <Alert tone="warning">{error}</Alert>}

      {!player && !error && <PlayerPublicSkeleton />}

      {player && <PlayerPublicView player={player} />}
    </AppShell>
  );
}
