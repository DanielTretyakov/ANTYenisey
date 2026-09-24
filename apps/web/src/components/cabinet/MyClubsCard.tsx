'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FavouriteClub, PublicUser } from '@yenisey/types';
import { MAX_FAVOURITE_CLUBS } from '@yenisey/types';
import { ClubMark } from '@/components/club/ClubMark';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { api, ApiError } from '@/lib/api';

/**
 * Мои клубы.
 *
 * Избранное и заявленная принадлежность — одна сущность, а не две. Отсюда
 * можно только снять отметку: отмечают клуб своим на его странице, там, где
 * человек и решает, что играет здесь.
 */
export function MyClubsCard({ user }: { user: PublicUser }) {
  const [clubs, setClubs] = useState<FavouriteClub[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    api
      .myClubs()
      .then(setClubs)
      .catch((cause: unknown) => setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен'));
  }, []);

  async function remove(slug: string): Promise<void> {
    setPending(slug);
    setError(null);

    try {
      setClubs(await api.removeClub(slug));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(null);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader
        title="Мои клубы"
        description={`Клубы, которые вы отметили своими. Не больше ${MAX_FAVOURITE_CLUBS}.`}
      />
      <CardBody>
        {error && <Alert>{error}</Alert>}

        {clubs === null && !error && <p className="text-[0.875rem] text-text-muted">Загружаю…</p>}

        {clubs?.length === 0 && (
          <p className="text-[0.875rem] text-text-muted">
            Пока ни одного.{' '}
            <Link href="/" className="text-text-accent underline-offset-2 hover:underline">
              Найдите клуб
            </Link>{' '}
            и отметьте его сердечком — он появится здесь и в ленте на стартовой странице.
          </p>
        )}

        {clubs && clubs.length > 0 && (
          <ul className="divide-y divide-border">
            {clubs.map((club) => (
              <li key={club.slug} className="flex items-center gap-4 py-3.5">
                <ClubMark club={club} size="sm" />

                <div className="min-w-0 grow">
                  <Link
                    href={`/clubs/${club.slug}`}
                    className="block truncate text-[0.9375rem] text-text underline-offset-2 hover:underline"
                  >
                    {club.name}
                  </Link>
                  <p className="mt-0.5 truncate text-[0.8125rem] text-text-muted">
                    {[club.city, ...club.otherCities].filter(Boolean).join(', ') || 'Город не указан'}
                    {roleLabel(user, club.slug)}
                  </p>
                </div>

                <Button variant="ghost" size="sm" pending={pending === club.slug} onClick={() => void remove(club.slug)}>
                  Убрать
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

const ROLE_LABELS: Record<string, string> = {
  CLIENT: 'клиент',
  COACH: 'тренер',
  ADMIN: 'администратор',
  OWNER: 'руководство клуба',
};

/**
 * Кем человек является в этом клубе.
 *
 * Пусто, если привязки нет: отметить клуб своим можно, ни разу в нём не
 * записавшись, и «клиент» в этом случае было бы неправдой.
 */
function roleLabel(user: PublicUser, slug: string): string {
  const role = user.memberships.find((membership) => membership.slug === slug)?.role;

  return role ? ` · ${ROLE_LABELS[role] ?? role}` : '';
}
