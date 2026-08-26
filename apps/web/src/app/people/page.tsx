'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { ClubPeoplePage, ClubPerson, Role } from '@yenisey/types';
import { AppShell } from '@/components/layout/AppShell';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { inputClassName } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/useSession';

/** Роли, которым доступен состав клуба. */
const MANAGERS: Role[] = ['ADMIN', 'OWNER'];

const ROLE_LABELS: Record<Role, string> = {
  CLIENT: 'Клиент',
  COACH: 'Тренер',
  ADMIN: 'Администратор',
  OWNER: 'Руководство',
};

/** Вкладки. «Все» первой: чаще нужно найти человека, чем перебрать роль. */
const TABS: { value: Role | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Все' },
  { value: 'OWNER', label: 'Руководство' },
  { value: 'ADMIN', label: 'Администраторы' },
  { value: 'COACH', label: 'Тренеры' },
  { value: 'CLIENT', label: 'Клиенты' },
];

const PAGE_SIZE = 50;

/**
 * Состав клуба: сотрудники и клиенты.
 *
 * Отдельным разделом, а не вкладкой в настройках клуба, намеренно. Настройки —
 * это то, что администратор правит изредка и осознанно; список людей он
 * открывает по несколько раз в день, чтобы кого-то найти. Складывать их в
 * одно место значит заставлять пролистывать цены ради телефона клиента.
 */
export default function PeoplePage() {
  const session = useSession();
  const router = useRouter();

  const [tab, setTab] = useState<Role | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<ClubPeoplePage | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const allowed = session.status === 'ready' && MANAGERS.includes(session.user.role);

  useEffect(() => {
    if (session.status === 'anonymous') {
      router.replace('/login');
    }
  }, [session.status, router]);

  // Смена вкладки или поиска возвращает к началу списка: иначе «показано
  // 51–100» на выборке из трёх человек показало бы пустую страницу.
  useEffect(() => {
    setOffset(0);
  }, [tab, search]);

  const load = useCallback(async () => {
    if (!allowed) return;

    setLoading(true);
    setError(null);

    try {
      setPage(
        await api.people({
          role: tab === 'ALL' ? undefined : tab,
          search: search.trim() || undefined,
          limit: PAGE_SIZE,
          offset,
        }),
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setLoading(false);
    }
  }, [allowed, tab, search, offset]);

  useEffect(() => {
    // Пауза перед запросом: без неё каждая буква в поиске — отдельный поход в
    // базу, и ответы возвращаются вперемешку.
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  const items = page?.items ?? [];
  const total = page?.total ?? 0;

  return (
    <AppShell
      actions={
        <Link href="/cabinet">
          <Button variant="ghost" size="sm">
            В кабинет
          </Button>
        </Link>
      }
    >
      <h1 className="mb-2 text-[1.75rem]">Состав клуба</h1>
      <p className="mb-7 max-w-2xl text-[0.9375rem] text-text-muted">
        Сотрудники и клиенты одним списком. Отключённые учётки остаются здесь и
        помечаются: удаления в продукте нет — за человеком висят платежи и история
        визитов, нужные бухгалтерии.
      </p>

      {session.status === 'ready' && !allowed && (
        <Alert>Раздел доступен только администратору и руководству клуба.</Alert>
      )}

      {error && <Alert>{error}</Alert>}

      {allowed && (
        <Card>
          <CardHeader
            title="Люди"
            description={
              loading
                ? 'Загружаю…'
                : `Показано ${items.length} из ${total} ${plural(total, 'человека', 'человек', 'человек')}`
            }
          />
          <CardBody>
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              {TABS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={tab === item.value}
                  onClick={() => setTab(item.value)}
                  className={cn(
                    'rounded-control border px-3.5 py-1.5 text-[0.875rem] transition-colors',
                    tab === item.value
                      ? 'border-border-accent bg-surface-accent-soft text-text-accent'
                      : 'border-border text-text-muted hover:bg-surface-sunken',
                  )}
                >
                  {item.label}
                </button>
              ))}

              <input
                aria-label="Поиск по людям"
                placeholder="Фамилия, почта или телефон"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className={cn(inputClassName, 'ml-auto w-64 py-1.5 text-[0.875rem]')}
              />
            </div>

            {items.length === 0 && !loading ? (
              <p className="text-[0.9375rem] text-text-muted">
                {search.trim() ? 'Никого не нашлось.' : 'В этой роли пока никого нет.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[0.875rem]">
                  <thead>
                    <tr className="border-b border-border text-left text-text-subtle">
                      <th className="py-2 pr-4 font-medium">ФИО</th>
                      <th className="py-2 pr-4 font-medium">Роль</th>
                      <th className="py-2 pr-4 font-medium">Почта</th>
                      <th className="py-2 pr-4 font-medium">Телефон</th>
                      <th className="py-2 font-medium">В клубе с</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((person) => (
                      <PersonRow key={person.id} person={person} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {total > PAGE_SIZE && (
              <div className="mt-4 flex items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={offset === 0 || loading}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Назад
                </Button>
                <span className="text-[0.8125rem] text-text-subtle">
                  {offset + 1}–{offset + items.length} из {total}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= total || loading}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Дальше
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </AppShell>
  );
}

function PersonRow({ person }: { person: ClubPerson }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-2.5 pr-4 text-text">
        {person.fullName}
        {person.deactivated && (
          <span className="ml-2 text-[0.75rem] tracking-[0.06em] text-text-subtle uppercase">
            отключён
          </span>
        )}
      </td>
      <td className="py-2.5 pr-4 text-text-muted">{ROLE_LABELS[person.role]}</td>
      <td className="py-2.5 pr-4 text-text-muted">{person.email}</td>
      <td className="py-2.5 pr-4 text-text-muted">{person.phone ?? '—'}</td>
      <td className="py-2.5 text-text-subtle">
        {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(new Date(person.createdAt))}
      </td>
    </tr>
  );
}

/** Русское склонение по числу: 1 человека, 2 человек, 5 человек. */
function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;

  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;

  return many;
}
