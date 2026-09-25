'use client';

import type { ReactNode } from 'react';
import type { PublicPlayer } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { AchievementList, EquipmentList, PlayerAvatar, RankLine } from './PlayerView';

/**
 * Страница игрока так, как её видят другие.
 *
 * Одна на две страницы: открытую `/players/:id` и «Мою страницу игрока» в
 * кабинете (решение владельца от 24.09.2026 — кабинет открывается тем, что
 * видят остальные, а редактор — отдельным шагом). Две вёрстки одной страницы
 * разошлись бы, и человек в кабинете видел бы не то, что видят другие.
 */
export function PlayerPublicView({
  player,
  eyebrow = 'Игрок',
  actions,
}: {
  player: PublicPlayer;
  /** Подпись над именем: «Игрок» на открытой странице, другое — в кабинете. */
  eyebrow?: string;
  /** Кнопки справа от имени — в кабинете там «Редактировать профиль». */
  actions?: ReactNode;
}) {
  return (
    <div className="grid gap-6">
      {player.hiddenFromPublic && (
        <Alert tone="info">
          Страница скрыта от посторонних до 14 лет — её видят сам игрок, родитель и администраторы клубов игрока.
        </Alert>
      )}

      <header className="flex flex-wrap items-center gap-6">
        <PlayerAvatar fileId={player.avatarFileId} name={player.name} size="lg" />
        <div className="min-w-0 grow">
          <p className="text-[0.75rem] tracking-[0.1em] text-text-subtle uppercase">{eyebrow}</p>
          <h1 className="mt-1 text-[2rem] leading-tight break-words">{player.name}</h1>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
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
  );
}

export function PlayerPublicSkeleton() {
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
