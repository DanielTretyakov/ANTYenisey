'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { PublicPlayer } from '@yenisey/types';
import { AppShell } from '@/components/layout/AppShell';
import { AchievementList, EquipmentList, PlayerAvatar, RankLine } from '@/components/player/PlayerView';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
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

      {!player && !error && <Skeleton />}

      {player && (
        <div className="grid gap-6">
          {player.hiddenFromPublic && (
            <Alert tone="info">
              Страница скрыта от посторонних до 16 лет — её видите только вы и администраторы клубов игрока.
            </Alert>
          )}

          <header className="flex flex-wrap items-center gap-6">
            <PlayerAvatar fileId={player.avatarFileId} name={player.name} size="lg" />
            <div className="min-w-0">
              <p className="text-[0.75rem] tracking-[0.1em] text-text-subtle uppercase">Игрок</p>
              <h1 className="mt-1 text-[2rem] leading-tight break-words">{player.name}</h1>
            </div>
          </header>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <div className="grid content-start gap-6">
              <Card>
                <CardHeader title="Разряд" />
                <CardBody>
                  {player.rank ? (
                    <RankLine rank={player.rank} />
                  ) : (
                    <p className="text-[0.875rem] text-text-muted">Разряд не указан.</p>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Инвентарь" />
                <CardBody>
                  <EquipmentList equipment={player.equipment} stacked />
                </CardBody>
              </Card>
            </div>

            <Card>
              <CardHeader title="Достижения" description="Список ведёт сам игрок." />
              <CardBody>
                <AchievementList achievements={player.achievements} />
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Skeleton() {
  return (
    <div className="grid gap-6" aria-busy="true">
      <div className="flex items-center gap-6">
        <span className="h-28 w-28 rounded-full bg-border/50" />
        <span className="h-8 w-56 rounded-full bg-border/50" />
      </div>
      <div className="h-48 rounded-card border border-border bg-surface-raised" />
    </div>
  );
}
