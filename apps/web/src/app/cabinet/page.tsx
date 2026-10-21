'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { MyExternalRatings, PublicPlayer } from '@yenisey/types';
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
        if (!cancelled) setError(cause instanceof ApiError ? cause.message : 'Нет связи. Проверьте интернет и попробуйте ещё раз');
      });

    return () => {
      cancelled = true;
    };
  }, [playerId]);

  const child = family.selected;
  const readOnly = !child && user !== null && isChildBirthDate(user.birthDate);

  // «Выберите себя» у плашек рейтингов (решение владельца от 20.10.2026).
  // Ребёнок до 14 сам не выбирает — за него родитель, переключателем.
  const [mine, setMine] = useState<MyExternalRatings | null>(null);
  const [claiming, setClaiming] = useState(false);
  const forPerson = child?.id ?? null;
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId || readOnly) return;

    let cancelled = false;
    setMine(null);

    api
      .myExternalRatings(forPerson)
      .then((found) => {
        if (!cancelled) setMine(found);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [userId, readOnly, forPerson]);

  async function changeClaim(action: () => Promise<MyExternalRatings>): Promise<void> {
    if (!playerId) return;

    setClaiming(true);
    setError(null);

    try {
      setMine(await action());
      setPlayer(await api.player(playerId));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Нет связи. Проверьте интернет и попробуйте ещё раз');
    } finally {
      setClaiming(false);
    }
  }

  return (
    <AppShell footer="line">
      {user && family.children.length > 0 && (
        <PersonSwitch people={family.children} selected={child} onChoose={family.choose} className="mb-8" />
      )}

      {error && <Alert>{error}</Alert>}

      {!player && !error && <PlayerPublicSkeleton />}

      {player && (
        <PlayerPublicView
          player={player}
          eyebrow={child ? 'Страница игрока — так её видят другие' : 'Моя страница игрока — так её видят другие'}
          ownRatings={
            mine
              ? {
                  mine,
                  busy: claiming,
                  onClaim: (system, externalId) =>
                    void changeClaim(() => api.claimExternalRating(system, externalId, forPerson)),
                  onUnclaim: (system) => void changeClaim(() => api.unclaimExternalRating(system, forPerson)),
                }
              : undefined
          }
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
