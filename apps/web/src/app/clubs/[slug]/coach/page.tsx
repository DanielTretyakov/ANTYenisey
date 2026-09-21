'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { CoachCard, CoachPrices } from '@yenisey/types';
import { CoachEditor, type CoachActions } from '@/components/coach/CoachEditor';
import { CoachPricesForm } from '@/components/coach/CoachPricesForm';
import { AppShell } from '@/components/layout/AppShell';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { api, ApiError } from '@/lib/api';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { useSession } from '@/lib/useSession';

/**
 * «Моя карточка» — кабинет тренера.
 *
 * Страница клубная, а карточка на ней — платформенная: она одна на все клубы,
 * где человек тренирует, и правится маршрутом без клуба (`/me/coach-card`).
 * Клубное на странице только цены — у каждого клуба свои.
 */
export default function MyCoachCardPage() {
  const club = useClubApi();
  const slug = useClubSlug();
  const session = useSession();
  const [profile, setProfile] = useState<CoachCard | null>(null);
  const [prices, setPrices] = useState<CoachPrices | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Карточка и цены приходят разными маршрутами, но страница у них одна:
    // отказ на любом из двух означает «эта страница не для вас».
    Promise.all([api.myCoachCard(), club.coachPrices()])
      .then(([card, loaded]) => {
        setProfile(card);
        setPrices(loaded);
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof ApiError && (cause.status === 403 || cause.status === 404)
            ? 'Эта страница — для тренеров клуба.'
            : cause instanceof ApiError
              ? cause.message
              : 'Не удалось связаться с сервером',
        ),
      );
  }, [club]);

  const actions = useMemo<CoachActions>(
    () => ({
      update: api.updateCoachCard,
      setPhoto: api.setCoachPhoto,
      removePhoto: api.removeCoachPhoto,
    }),
    [],
  );

  const name = session.status === 'ready' ? (session.user?.fullName ?? 'Тренер') : 'Тренер';

  return (
    <AppShell clubSlug={slug}>
      <h1 className="mb-6 text-[2rem] leading-tight">Моя карточка</h1>

      {error && <Alert tone="warning">{error}</Alert>}

      {profile && (
        <div className="grid gap-6">
          <Card>
            <CardHeader
              title="Карточка тренера"
              description="Её видят все, не входя: по ней выбирают, к кому идти заниматься. Карточка одна на все клубы, где вы тренируете."
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

          {prices && (
            <Card>
              <CardHeader
                title="Стоимость занятий в этом клубе"
                description="У каждого клуба цена своя — она показывается на странице тренера рядом с названием клуба."
              />
              <CardBody>
                <CoachPricesForm prices={prices} save={club.updateCoachPrices} onChange={setPrices} />
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </AppShell>
  );
}
