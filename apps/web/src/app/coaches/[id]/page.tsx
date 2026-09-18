'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { PublicCoach } from '@yenisey/types';
import { CoachCardBody } from '@/components/coach/CoachView';
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
 * Клуба в адресе нет, а карточка принадлежит клубу: показывается самая свежая,
 * остальные клубы перечисляются рядом.
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
            <PlayerAvatar fileId={coach.photoFileId} name={coach.name} size="lg" />
            <div className="min-w-0">
              <p className="text-[0.75rem] tracking-[0.1em] text-text-subtle uppercase">Тренер</p>
              <h1 className="mt-1 text-[2rem] leading-tight break-words">{coach.name}</h1>
              <p className="mt-1.5 text-[0.9375rem] text-text-muted">
                <Link href={`/clubs/${coach.club.slug}`} className="text-text-accent underline-offset-2 hover:underline">
                  {coach.club.name}
                </Link>
                {coach.otherClubs.length > 0 && (
                  <>
                    {' · также тренирует в '}
                    {coach.otherClubs.map((other, index) => (
                      <span key={other.slug}>
                        {index > 0 && ', '}
                        <Link
                          href={`/clubs/${other.slug}`}
                          className="text-text-accent underline-offset-2 hover:underline"
                        >
                          {other.name}
                        </Link>
                      </span>
                    ))}
                  </>
                )}
              </p>
            </div>
          </header>

          <CoachCardBody card={coach} />
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
