'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { CoachProfile } from '@yenisey/types';
import { CoachEditor, type CoachActions } from '@/components/coach/CoachEditor';
import { AppShell } from '@/components/layout/AppShell';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { useSession } from '@/lib/useSession';

/**
 * «Моя карточка» — кабинет тренера в клубе.
 *
 * Клуб в адресе обязателен: карточка принадлежит клубу, и у тренера двух
 * клубов их две, с разной ценой. Поэтому она здесь, а не в платформенном
 * «Кабинете», где живёт профиль игрока.
 */
export default function MyCoachCardPage() {
  const club = useClubApi();
  const slug = useClubSlug();
  const session = useSession();
  const [profile, setProfile] = useState<CoachProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    club
      .coachProfile()
      .then(setProfile)
      .catch((cause: unknown) =>
        setError(
          cause instanceof ApiError && cause.status === 403
            ? 'Эта страница — для тренеров клуба.'
            : cause instanceof ApiError
              ? cause.message
              : 'Не удалось связаться с сервером',
        ),
      );
  }, [club]);

  const actions = useMemo<CoachActions>(
    () => ({
      update: club.updateCoachProfile,
      setPhoto: club.setCoachPhoto,
      removePhoto: club.removeCoachPhoto,
    }),
    [club],
  );

  const name = session.status === 'ready' ? (session.user?.fullName ?? 'Тренер') : 'Тренер';

  return (
    <AppShell clubSlug={slug}>
      <h1 className="mb-6 text-[2rem] leading-tight">Моя карточка</h1>

      {error && <Alert tone="warning">{error}</Alert>}

      {profile && (
        <Card>
          <CardHeader
            title="Карточка тренера"
            description="Её видят все, не входя: по ней выбирают, к кому идти заниматься."
          />
          <CardBody className="grid gap-7">
            <CoachEditor profile={profile} name={name} actions={actions} onChange={setProfile} />

            <p className="text-[0.875rem]">
              <Link
                href={`/coaches/${profile.userId}`}
                className="text-text-accent underline-offset-2 hover:underline"
              >
                Открыть мою страницу тренера →
              </Link>
            </p>
          </CardBody>
        </Card>
      )}
    </AppShell>
  );
}
