'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { PublicCoach } from '@yenisey/types';
import { CoachCardBody, CoachPricesView } from '@/components/coach/CoachView';
import { AppShell } from '@/components/layout/AppShell';
import { PlayerAvatar } from '@/components/player/PlayerView';
import { Alert } from '@/components/ui/Alert';
import { api, ApiError } from '@/lib/api';

/**
 * Страница тренера — открыта всем, без входа.
 *
 * Имя — «Фамилия И.», как в списке мероприятий клуба; ни телефона, ни почты
 * сервер сюда не отдаёт. Возрастного ограничения, в отличие от страницы
 * игрока, здесь нет: тренером человек становится взрослым.
 *
 * Карточка одна на все клубы, а цены у каждого клуба свои — поэтому клубы
 * перечислены отдельным блоком, каждый со своей стоимостью занятий.
 */
export default function CoachPage() {
  const params = useParams<{ id: string }>();
  const [coach, setCoach] = useState<PublicCoach | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .coach(params.id)
      .then(setCoach)
      .catch((cause: unknown) =>
        setError(
          cause instanceof ApiError && cause.status === 404
            ? 'Тренер не найден.'
            : 'Не удалось связаться с сервером',
        ),
      );
  }, [params.id]);

  return (
    <AppShell>
      {error && <Alert tone="warning">{error}</Alert>}

      {!coach && !error && <Skeleton />}

      {coach && (
        <div className="grid gap-8">
          <header className="flex flex-wrap items-center gap-6">
            <PlayerAvatar fileId={coach.photoFileId} name={coach.name} gender={coach.gender} size="lg" />
            <div className="min-w-0">
              <p className="text-[0.75rem] tracking-[0.1em] text-text-subtle uppercase">Тренер</p>
              <h1 className="mt-1 text-[2rem] leading-tight break-words">{coach.name}</h1>
              <p className="mt-1.5 text-[0.9375rem] text-text-muted">
                {'Тренер в клубах: '}
                {coach.clubs.map((club, index) => (
                  <span key={club.slug}>
                    {index > 0 && ', '}
                    <Link
                      href={`/clubs/${club.slug}`}
                      className="text-text-accent underline-offset-2 hover:underline"
                    >
                      {club.name}
                    </Link>
                  </span>
                ))}
              </p>
            </div>
          </header>

          <CoachCardBody card={coach} />

          {/* Цены — по клубу: в соседнем у того же тренера они другие, и общая
              строка «1500 ₽» ввела бы в заблуждение. */}
          <section>
            <h3 className="mb-3 text-[0.9375rem] font-medium">Стоимость занятий</h3>
            <ul className="grid gap-4">
              {coach.clubs.map((club) => (
                <li key={club.slug} className="rounded-card border border-border bg-surface-raised px-5 py-4">
                  <Link
                    href={`/clubs/${club.slug}`}
                    className="text-[0.9375rem] font-medium text-text-accent underline-offset-2 hover:underline"
                  >
                    {club.name}
                  </Link>
                  <div className="mt-1.5">
                    <CoachPricesView prices={club} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
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
