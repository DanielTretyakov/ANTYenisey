'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { PublicPlayer } from '@yenisey/types';
import { sectionHref } from '@/components/cabinet/sections';
import { PersonSwitch } from '@/components/family/PersonSwitch';
import { AppShell } from '@/components/layout/AppShell';
import { PlayerPublicSkeleton, PlayerPublicView } from '@/components/player/PlayerPublicView';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { api, ApiError } from '@/lib/api';
import { isChildBirthDate } from '@/lib/family';
import { usePersonSwitch } from '@/lib/usePersonSwitch';
import { useSession } from '@/lib/useSession';

/**
 * Кабинет открывается «Моей страницей игрока» — тем, что видят другие
 * (решение владельца от 24.09.2026). Правка — отдельным шагом, в редакторе по
 * разделам (`/cabinet/edit/...`): человек сначала видит себя со стороны и
 * только потом решает, что поменять.
 *
 * Страница — та же, что открытая `/players/:id` (`PlayerPublicView`), и данные
 * те же: второй вид «для себя» разошёлся бы с тем, что видят остальные.
 * Родитель с переключателем смотрит страницу выбранного ребёнка — сервер
 * отдаёт её ему как опекуну.
 */
export default function CabinetPage() {
  const router = useRouter();
  const session = useSession();
  const family = usePersonSwitch();

  const [player, setPlayer] = useState<PublicPlayer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.status === 'anonymous') {
      router.replace('/login?next=%2Fcabinet');
    }
  }, [session.status, router]);

  const user = session.status === 'ready' ? session.user : null;
  const playerId = family.selected?.id ?? user?.id ?? null;

  useEffect(() => {
    if (!playerId) return;

    let cancelled = false;
    setPlayer(null);
    setError(null);

    api
      .player(playerId)
      .then((found) => {
        if (!cancelled) setPlayer(found);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером');
      });

    return () => {
      cancelled = true;
    };
  }, [playerId]);

  const child = family.selected;
  const readOnly = !child && user !== null && isChildBirthDate(user.birthDate);

  return (
    <AppShell>
      {user && family.children.length > 0 && (
        <PersonSwitch people={family.children} selected={child} onChoose={family.choose} className="mb-8" />
      )}

      {error && <Alert>{error}</Alert>}

      {!player && !error && <PlayerPublicSkeleton />}

      {player && (
        <PlayerPublicView
          player={player}
          eyebrow={child ? 'Страница игрока — так её видят другие' : 'Моя страница игрока — так её видят другие'}
          actions={
            <Link href={sectionHref('player', child?.id ?? null)}>
              <Button variant={readOnly ? 'secondary' : 'primary'}>
                {readOnly ? 'Профиль и настройки' : 'Редактировать профиль'}
              </Button>
            </Link>
          }
        />
      )}
    </AppShell>
  );
}
