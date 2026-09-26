'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { hasAnyRole, MANAGING_ROLES, type ClubLedgerPage, type ClubLedgerRow, type Role } from '@yenisey/types';
import { AdminShell } from '@/components/layout/AdminShell';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { inputClassName } from '@/components/ui/Field';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { rolesInClub } from '@/lib/membership';
import { plural } from '@/lib/plural';
import { ledgerLabel } from '@/lib/subscriptions';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { useSession } from '@/lib/useSession';

const PAGE_SIZE = 50;

/**
 * История абонементов клуба — все движения визитов подряд.
 *
 * Раздел нужен потому, что деньги за абонементы принимают вне системы: журнал
 * остаётся единственным следом того, кто что продал, за кого списали визит и
 * кому его вернули. Править здесь нечего — журнал только на вставку, — поэтому
 * страница целиком на чтение, с поиском по человеку.
 */
export default function ClubSubscriptionsPage() {
  const session = useSession();
  const router = useRouter();
  const slug = useClubSlug();
  const club = useClubApi();

  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<ClubLedgerPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const roles = session.status === 'ready' ? rolesInClub(session.user, slug) : [];
  const allowed = hasAnyRole(roles, MANAGING_ROLES);

  useEffect(() => {
    if (session.status === 'anonymous') {
      router.replace('/login');
    }
  }, [session.status, router]);

  // Новый поиск — снова с начала: «показано 51–100» на выборке из трёх строк
  // показало бы пустую страницу.
  useEffect(() => {
    setOffset(0);
  }, [search]);

  const load = useCallback(async () => {
    if (!allowed) return;

    setLoading(true);
    setError(null);

    try {
      setPage(await club.subscriptionLedger({ search: search.trim() || undefined, limit: PAGE_SIZE, offset }));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setLoading(false);
    }
  }, [allowed, club, search, offset]);

  useEffect(() => {
    // Пауза перед запросом: иначе каждая буква в поиске — отдельный поход в
    // базу, и ответы возвращаются вперемешку.
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  const items = page?.items ?? [];
  const total = page?.total ?? 0;

  return (
    <AdminShell>
      <h1 className="mb-2 text-[1.75rem]">Абонементы</h1>
      <p className="mb-7 max-w-2xl text-[0.9375rem] text-text-muted">
        Все движения визитов клуба: продажи, списания при записи, возвраты при отмене и
        ручные корректировки. Журнал только пополняется — исправить строку нельзя ни
        здесь, ни в базе; ошибку поправляют новой корректировкой с причиной.
      </p>

      {session.status === 'ready' && !allowed && (
        <Alert>Раздел доступен только администратору и руководству клуба.</Alert>
      )}

      {error && <Alert>{error}</Alert>}

      {allowed && (
        <Card>
          <CardHeader
            title="Движения"
            description={
              loading
                ? 'Загружаю…'
                : `Показано ${items.length} из ${total} ${plural(total, 'движения', 'движений', 'движений')}`
            }
          />
          <CardBody>
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              <input
                aria-label="Поиск по владельцу абонемента"
                placeholder="Фамилия владельца"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className={cn(inputClassName, 'ml-auto w-64 py-1.5 text-[0.875rem]')}
              />
            </div>

            {items.length === 0 && !loading ? (
              <p className="text-[0.9375rem] text-text-muted">
                {search.trim() ? 'По этому человеку движений нет.' : 'Движений по абонементам пока не было.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[0.875rem]">
                  <thead>
                    <tr className="border-b border-border text-left text-text-subtle">
                      <th className="py-2 pr-4 font-medium">Когда</th>
                      <th className="py-2 pr-4 font-medium">Кто</th>
                      <th className="py-2 pr-4 font-medium">Тариф</th>
                      <th className="py-2 pr-4 text-right font-medium">Визиты</th>
                      <th className="py-2 pr-4 text-right font-medium">Остаток</th>
                      <th className="py-2 font-medium">Что произошло</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row) => (
                      <LedgerRow key={row.id} row={row} slug={slug} />
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
    </AdminShell>
  );
}

function LedgerRow({ row, slug }: { row: ClubLedgerRow; slug: string }) {
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="py-2 pr-4 whitespace-nowrap tabular-nums text-text-muted">
        {new Intl.DateTimeFormat('ru-RU', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(row.at))}
      </td>
      <td className="py-2 pr-4">
        {/* Из истории всегда есть ход в карточку: вопрос «куда делся визит»
            почти никогда не кончается одной строкой. */}
        <Link
          href={`/clubs/${slug}/people/${row.person.id}`}
          className="text-text-accent underline-offset-2 hover:underline"
        >
          {row.person.fullName}
        </Link>
      </td>
      <td className="py-2 pr-4 text-text-muted">{row.planName}</td>
      <td className="py-2 pr-4 text-right tabular-nums">{row.delta > 0 ? `+${row.delta}` : row.delta}</td>
      <td className="py-2 pr-4 text-right tabular-nums text-text-muted">{row.balanceAfter ?? '∞'}</td>
      <td className="py-2 break-words text-text-muted">{ledgerLabel(row)}</td>
    </tr>
  );
}
