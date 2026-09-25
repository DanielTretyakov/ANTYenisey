'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ClubCard, FavouriteClub, PublicUser } from '@yenisey/types';
import { MAX_FAVOURITE_CLUBS } from '@yenisey/types';
import { ClubMark } from '@/components/club/ClubMark';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { inputClassName } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';

/**
 * Мои клубы.
 *
 * Избранное и заявленная принадлежность — одна сущность, а не две. Отметить
 * клуб можно и на его странице (сердечко), и здесь — поиском по названию
 * (решение владельца от 25.09.2026: «добавить клуб» без похода на стартовую).
 */
export function MyClubsCard({ user }: { user: PublicUser }) {
  const [clubs, setClubs] = useState<FavouriteClub[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api
      .myClubs()
      .then(setClubs)
      .catch((cause: unknown) => setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен'));
  }, []);

  async function add(slug: string): Promise<void> {
    setPending(slug);
    setError(null);

    try {
      setClubs(await api.addClub(slug));
      setAdding(false);
    } catch (cause) {
      // «Клубов уже три» приходит текстом от сервера: предел живёт в базе.
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(null);
    }
  }

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

        {clubs?.length === 0 && !adding && (
          <p className="text-[0.875rem] text-text-muted">
            Пока ни одного. Добавьте клуб — он появится здесь и в ленте на стартовой странице.
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

        {clubs !== null &&
          (adding ? (
            <AddClub
              taken={clubs.map((club) => club.slug)}
              pending={pending}
              onAdd={(slug) => void add(slug)}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant="secondary"
                disabled={clubs.length >= MAX_FAVOURITE_CLUBS}
                onClick={() => setAdding(true)}
              >
                + Добавить клуб
              </Button>
              {clubs.length >= MAX_FAVOURITE_CLUBS && (
                <span className="text-[0.8125rem] text-text-subtle">
                  Своих клубов уже {MAX_FAVOURITE_CLUBS} — уберите один, чтобы добавить другой.
                </span>
              )}
            </div>
          ))}
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

/**
 * Поиск клуба по названию прямо в карточке. Тот же поиск, что на стартовой
 * (`GET /clubs?query=`), без фильтра по городу: свой клуб человек ищет по
 * имени, а не по карте.
 */
function AddClub({
  taken,
  pending,
  onAdd,
  onCancel,
}: {
  taken: string[];
  pending: string | null;
  onAdd: (slug: string) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<ClubCard[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .searchClubs({ query: query.trim() || undefined })
        .then((clubs) => {
          if (!cancelled) setFound(clubs.slice(0, 8));
        })
        .catch(() => {
          if (!cancelled) setFound([]);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const available = (found ?? []).filter((club) => !taken.includes(club.slug));

  return (
    <div className="mt-4 rounded-control border border-border bg-surface-sunken p-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-0 grow">
          <span className="sr-only">Название клуба</span>
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Название клуба"
            className={inputClassName}
          />
        </label>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
      </div>

      {found === null && <p className="mt-3 text-[0.875rem] text-text-muted">Ищу…</p>}

      {found !== null && available.length === 0 && (
        <p className="mt-3 text-[0.875rem] text-text-muted">
          {query.trim() ? 'Ничего не нашлось — попробуйте другое написание.' : 'Все клубы уже ваши.'}
        </p>
      )}

      {available.length > 0 && (
        <ul className="mt-3 divide-y divide-border">
          {available.map((club) => (
            <li key={club.slug} className="flex items-center gap-3 py-2.5">
              <ClubMark club={club} size="sm" />
              <span className="min-w-0 grow">
                <span className="block truncate text-[0.9375rem] text-text">{club.name}</span>
                <span className="block truncate text-[0.8125rem] text-text-muted">
                  {[club.city, ...club.otherCities].filter(Boolean).join(', ') || 'Город не указан'}
                </span>
              </span>
              <Button size="sm" pending={pending === club.slug} disabled={pending !== null} onClick={() => onAdd(club.slug)}>
                Добавить
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
