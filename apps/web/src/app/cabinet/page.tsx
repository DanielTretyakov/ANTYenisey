'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { FavouriteClub, PublicUser } from '@yenisey/types';
import { MAX_FAVOURITE_CLUBS } from '@yenisey/types';
import { ClubMark } from '@/components/club/ClubMark';
import { AppShell } from '@/components/layout/AppShell';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/useSession';

/**
 * Личный кабинет: профиль и мои клубы.
 *
 * Списка записей здесь БОЛЬШЕ НЕТ — он уехал в раздел «Мои записи» целиком,
 * вместе с прошедшими и турнирами (ТЗ → «Мои записи»). Два списка записей в
 * двух местах разошлись бы в поведении отмены и в том, что каждый из них
 * показывает.
 *
 * Роли в профиле тоже нет: она свойство пары «человек + клуб», а не человека.
 * Кем он в каком клубе является, видно в списке клубов ниже.
 */
export default function CabinetPage() {
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    if (session.status === 'anonymous') {
      router.replace('/login');
    }
  }, [session.status, router]);

  const user = session.status === 'ready' ? session.user : null;

  return (
    <AppShell>
      <h1 className="mb-7 text-[1.75rem]">Личный кабинет</h1>

      {user ? <Profile user={user} /> : <ProfileSkeleton />}

      {user && <MyClubs user={user} />}
    </AppShell>
  );
}

function Profile({ user }: { user: PublicUser }) {
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Профиль" description="Данные, которые видит администратор клуба." />
      <CardBody>
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <Row label="ФИО" value={user.fullName} />
          <Row label="Электронная почта" value={user.email} />
          <Row label="Телефон" value={user.phone ?? '—'} />
          <Row label="Дата рождения" value={formatBirthDate(user.birthDate)} />
        </dl>
      </CardBody>
    </Card>
  );
}

/**
 * Мои клубы.
 *
 * Избранное и заявленная принадлежность — одна сущность, а не две. Отсюда
 * можно только снять отметку: отмечают клуб своим на его странице, там, где
 * человек и решает, что играет здесь.
 */
function MyClubs({ user }: { user: PublicUser }) {
  const [clubs, setClubs] = useState<FavouriteClub[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    api
      .myClubs()
      .then(setClubs)
      .catch((cause: unknown) =>
        setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен'),
      );
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
    <Card className="mt-6 max-w-2xl">
      <CardHeader
        title="Мои клубы"
        description={`Клубы, которые вы отметили своими. Не больше ${MAX_FAVOURITE_CLUBS}.`}
      />
      <CardBody>
        {error && <Alert>{error}</Alert>}

        {clubs === null && <p className="text-[0.875rem] text-text-muted">Загружаю…</p>}

        {clubs?.length === 0 && (
          <p className="text-[0.875rem] text-text-muted">
            Пока ни одного.{' '}
            <Link href="/" className="text-text-accent underline-offset-2 hover:underline">
              Найдите клуб
            </Link>{' '}
            и отметьте его своим — он появится здесь и в ленте на стартовой странице.
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
                    {[club.city, ...club.otherCities].filter(Boolean).join(', ') ||
                      'Город не указан'}
                    {roleLabel(user, club.slug)}
                  </p>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  pending={pending === club.slug}
                  onClick={() => void remove(club.slug)}
                >
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.75rem] tracking-[0.1em] text-text-subtle uppercase">{label}</dt>
      <dd className="mt-1 text-[0.9375rem] text-text">{value}</dd>
    </div>
  );
}

/**
 * Заглушка на время загрузки профиля.
 *
 * Серые полосы вместо надписи «Загружаю…»: они занимают ровно то место, куда
 * встанут данные, и карточка не подпрыгивает в момент ответа сервера.
 */
function ProfileSkeleton() {
  return (
    <Card className="max-w-2xl" aria-busy="true">
      <CardHeader title="Профиль" description="Загружаю данные…" />
      <CardBody>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {[0, 1, 2, 3].map((index) => (
            <div key={index}>
              <div className="h-2.5 w-24 rounded-full bg-border" />
              <div className="mt-2.5 h-3.5 w-40 rounded-full bg-border" />
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

/** «17 мая 2001». Дата рождения приходит как «2001-05-17». */
function formatBirthDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);

  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(parsed);
}
