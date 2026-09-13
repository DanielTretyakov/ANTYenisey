'use client';

import type { PlayerAchievement, PlayerEquipment, PlayerRank, PublicRank } from '@yenisey/types';
import { cn } from '@/lib/cn';
import { LEVEL_LABELS, longDate, placeLabel, RANK_LABELS, RANK_TITLES, rankStatusLine } from '@/lib/player';
import { useFileUrl } from '@/lib/useFileUrl';

/**
 * Куски профиля игрока, одинаковые в трёх местах: в «Кабинете», на
 * публичной странице и в карточке человека у администратора. Три копии
 * разошлись бы на первой же правке подписи.
 */

const AVATAR_SIZES = {
  sm: 'h-12 w-12 text-[0.9375rem]',
  md: 'h-20 w-20 text-xl',
  lg: 'h-28 w-28 text-3xl',
} as const;

/** Аватар или инициалы, пока его нет. Байты читаются от имени вошедшего. */
export function PlayerAvatar({
  fileId,
  name,
  size = 'md',
}: {
  fileId: string | null;
  name: string;
  size?: keyof typeof AVATAR_SIZES;
}) {
  const url = useFileUrl(fileId);

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        'border border-border bg-surface-sunken font-display text-text-muted',
        AVATAR_SIZES[size],
      )}
    >
      {url ? (
        // Обычный <img>, а не next/image: адрес — blob:, оптимизатору нечего
        // с ним делать.
        <img src={url} alt={`Фотография: ${name}`} className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
    </span>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

const EQUIPMENT_ROWS: { key: keyof PlayerEquipment; label: string }[] = [
  { key: 'blade', label: 'Основание' },
  { key: 'forehandRubber', label: 'Накладка справа' },
  { key: 'backhandRubber', label: 'Накладка слева' },
];

/** `stacked` — в столбик, для узкой колонки; иначе три поля в ряд. */
export function EquipmentList({ equipment, stacked = false }: { equipment: PlayerEquipment; stacked?: boolean }) {
  const filled = EQUIPMENT_ROWS.filter((row) => equipment[row.key]);

  if (filled.length === 0) {
    return <p className="text-[0.875rem] text-text-muted">Инвентарь не указан.</p>;
  }

  return (
    <dl className={cn('grid gap-x-8 gap-y-3', !stacked && 'sm:grid-cols-3')}>
      {filled.map((row) => (
        <div key={row.key}>
          <dt className="text-[0.75rem] tracking-[0.06em] text-text-subtle uppercase">{row.label}</dt>
          <dd className="mt-0.5 text-[0.9375rem] break-words">{equipment[row.key]}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Одно достижение в строку: место — крупно, всё остальное — подписью. */
export function AchievementRow({ achievement }: { achievement: PlayerAchievement }) {
  const medal = achievement.place !== null && achievement.place <= 3;

  return (
    <div className="flex min-w-0 items-baseline gap-4">
      <span
        className={cn(
          'w-[4.5rem] shrink-0 text-[0.875rem] tabular-nums',
          medal ? 'font-medium text-text-accent' : 'text-text-muted',
        )}
      >
        {placeLabel(achievement.place)}
      </span>
      <span className="min-w-0">
        <span className="block text-[0.9375rem] break-words">{achievement.title}</span>
        <span className="mt-0.5 block text-[0.8125rem] text-text-muted">
          {[longDate(achievement.date), LEVEL_LABELS[achievement.level], achievement.note]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
    </div>
  );
}

export function AchievementList({ achievements }: { achievements: PlayerAchievement[] }) {
  if (achievements.length === 0) {
    return <p className="text-[0.875rem] text-text-muted">Достижений пока нет.</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {achievements.map((achievement) => (
        <li key={achievement.id} className="py-3 first:pt-0 last:pb-0">
          <AchievementRow achievement={achievement} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Разряд и его проверка. Цвет — только у двух состояний, за которыми есть
 * смысл: подтверждён (акцент) и отклонён (предупреждение). «На проверке» —
 * обычный приглушённый текст.
 */
export function RankLine({ rank }: { rank: PlayerRank | PublicRank }) {
  return (
    <div>
      <p className="font-display text-[1.375rem] leading-tight" title={RANK_TITLES[rank.rank]}>
        {RANK_LABELS[rank.rank]}
      </p>
      <p
        className={cn(
          'mt-1 text-[0.875rem]',
          rank.status === 'VERIFIED' && 'text-text-accent',
          rank.status === 'REJECTED' && 'text-warning',
          rank.status === 'PENDING' && 'text-text-muted',
        )}
      >
        {rankStatusLine(rank)}
      </p>
    </div>
  );
}
