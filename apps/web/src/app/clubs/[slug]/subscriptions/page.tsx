'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  hasAnyRole,
  MANAGING_ROLES,
  type ClubLedgerPage,
  type ClubLedgerRow,
  type SubscriptionHolder,
  type SubscriptionHoldersPage,
} from '@yenisey/types';
import { AdminShell } from '@/components/layout/AdminShell';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { inputClassName } from '@/components/ui/Field';
import { CompactSelect } from '@/components/ui/CompactSelect';
import { Tab } from '@/components/ui/Tab';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { rolesInClub } from '@/lib/membership';
import { plural } from '@/lib/plural';
import { ledgerLabel, remainingLabel, validUntilLabel } from '@/lib/subscriptions';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { useSession } from '@/lib/useSession';

const PAGE_SIZE = 50;

type View = 'active' | 'archive' | 'ledger';

/**
 * Вкладки раздела (решение владельца от 26.09.2026). Выбранная — в адресе:
 * ссылку «кто сейчас с абонементом» пересылают так же, как экран смены.
 */
const VIEWS: { value: View; hash: string; label: string }[] = [
  { value: 'active', hash: 'dejstvuyushchie', label: 'Действующие' },
  { value: 'archive', hash: 'arhiv', label: 'Архив' },
  { value: 'ledger', hash: 'dvizheniya', label: 'Движения' },
];

/**
 * Абонементы клуба: у кого есть, у кого кончились, и все движения визитов.
 *
 * Деньги за абонементы принимают вне системы: журнал движений остаётся
 * единственным следом того, кто что продал, за кого списали визит и кому его
 * вернули. Править здесь нечего — продажа и корректировка живут в карточке
 * человека, куда ведёт каждое имя.
 */
export default function ClubSubscriptionsPage() {
  const session = useSession();
  const router = useRouter();
  const slug = useClubSlug();

  const [view, setView] = useState<View>('active');
  const [search, setSearch] = useState('');

  const roles = session.status === 'ready' ? rolesInClub(session.user, slug) : [];
  const allowed = hasAnyRole(roles, MANAGING_ROLES);

  useEffect(() => {
    if (session.status === 'anonymous') {
      router.replace('/login');
    }
  }, [session.status, router]);

  // Вкладка из адреса — в эффекте, а не при отрисовке: на сервере адреса нет.
  useEffect(() => {
    const found = VIEWS.find((item) => `#${item.hash}` === window.location.hash);

    if (found) setView(found.value);
  }, []);

  function choose(next: View): void {
    setView(next);
    window.history.replaceState(null, '', `#${VIEWS.find((item) => item.value === next)!.hash}`);
  }

  return (
    <AdminShell>
      <h1 className="mb-2 text-[1.75rem]">Абонементы</h1>
      <p className="mb-7 max-w-2xl text-[0.9375rem] text-text-muted">
        У кого абонемент сейчас, у кого кончился и не продлён, и все движения визитов. Продают
        и корректируют абонемент в карточке человека — туда ведёт каждое имя.
      </p>

      {session.status === 'ready' && !allowed && (
        <Alert>Раздел доступен только администратору и руководству клуба.</Alert>
      )}

      {allowed && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            {/* На телефоне — список (решение от 03.10.2026). */}
            <CompactSelect
              label="Показать"
              value={view}
              options={VIEWS.map((item) => ({ value: item.value, label: item.label }))}
              onChange={(value) => {
                const item = VIEWS.find((candidate) => candidate.value === value);
                if (item) choose(item.value);
              }}
              className="w-full sm:hidden"
            />

            <div className="hidden flex-wrap items-center gap-1.5 sm:flex" role="tablist" aria-label="Абонементы">
              {VIEWS.map((item) => (
                <Tab key={item.value} inTablist active={view === item.value} onClick={() => choose(item.value)}>
                  {item.label}
                </Tab>
              ))}
            </div>

            <input
              aria-label="Поиск по владельцу абонемента"
              placeholder="Фамилия владельца"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className={cn(inputClassName, 'w-full py-1.5 text-[0.875rem] sm:ml-auto sm:w-64')}
            />
          </div>

          {view === 'ledger' ? (
            <LedgerView search={search} slug={slug} />
          ) : (
            <HoldersView key={view} status={view} search={search} slug={slug} />
          )}
        </>
      )}
    </AdminShell>
  );
}

/* ==========================================================================
   Действующие и архив
   ========================================================================== */

function HoldersView({ status, search, slug }: { status: 'active' | 'archive'; search: string; slug: string }) {
  const club = useClubApi();
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<SubscriptionHoldersPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Новый поиск — снова с начала: «показано 51–100» на выборке из трёх строк
  // показало бы пустую страницу.
  useEffect(() => {
    setOffset(0);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setPage(
        await club.subscriptionHolders({ status, search: search.trim() || undefined, limit: PAGE_SIZE, offset }),
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setLoading(false);
    }
  }, [club, status, search, offset]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  const items = page?.items ?? [];
  const total = page?.total ?? 0;
  const active = status === 'active';

  return (
    <Card>
      <CardHeader
        title={active ? 'Действующие абонементы' : 'Архив'}
        description={
          loading
            ? 'Загружаю…'
            : active
              ? `${total} ${plural(total, 'абонемент', 'абонемента', 'абонементов')}. Сверху — у кого срок кончается раньше: им пора предложить продление.`
              : `${total} ${plural(total, 'человек', 'человека', 'человек')} без действующего абонемента — последний абонемент каждого, недавно кончившиеся сверху.`
        }
      />
      <CardBody>
        {error && <Alert>{error}</Alert>}

        {items.length === 0 && !loading ? (
          <p className="text-[0.9375rem] text-text-muted">
            {search.trim()
              ? 'Никого не нашлось.'
              : active
                ? 'Действующих абонементов нет.'
                : 'Архив пуст: у всех, кто покупал абонемент, он действует.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[0.875rem]">
              <thead>
                <tr className="border-b border-border text-left text-text-subtle">
                  <th className="py-2 pr-4 font-medium">Кто</th>
                  <th className="py-2 pr-4 font-medium">Телефон</th>
                  <th className="py-2 pr-4 font-medium">Тариф</th>
                  <th className="py-2 pr-4 font-medium">{active ? 'Остаток' : 'Осталось визитов'}</th>
                  <th className="py-2 font-medium">{active ? 'Действует' : 'Кончился'}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <HolderRow key={row.subscriptionId} row={row} active={active} slug={slug} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pager total={total} offset={offset} shown={items.length} loading={loading} onOffset={setOffset} />
      </CardBody>
    </Card>
  );
}

function HolderRow({ row, active, slug }: { row: SubscriptionHolder; active: boolean; slug: string }) {
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="py-2 pr-4">
        <Link
          href={`/clubs/${slug}/people/${row.person.id}`}
          className="text-text-accent underline-offset-2 hover:underline"
        >
          {row.person.fullName}
        </Link>
      </td>
      <td className="py-2 pr-4 whitespace-nowrap text-text-muted">{row.person.phone}</td>
      <td className="py-2 pr-4">
        {row.planName}
        {row.covers.length > 0 && (
          <span className="block text-[0.75rem] text-text-subtle">{row.covers.join(', ')}</span>
        )}
      </td>
      <td className="py-2 pr-4 text-text-muted">
        {active
          ? remainingLabel(row.remainingVisits)
          : row.remainingVisits === null
            ? '—'
            : row.remainingVisits === 0
              ? 'все израсходованы'
              : `${row.remainingVisits} сгорело по сроку`}
      </td>
      <td className="py-2 whitespace-nowrap text-text-muted">
        {active ? validUntilLabel(row.expiresAt) : row.endedAt ? shortDate(row.endedAt) : '—'}
      </td>
    </tr>
  );
}

/* ==========================================================================
   Движения
   ========================================================================== */

function LedgerView({ search, slug }: { search: string; slug: string }) {
  const club = useClubApi();
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<ClubLedgerPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setOffset(0);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setPage(await club.subscriptionLedger({ search: search.trim() || undefined, limit: PAGE_SIZE, offset }));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setLoading(false);
    }
  }, [club, search, offset]);

  useEffect(() => {
    // Пауза перед запросом: иначе каждая буква в поиске — отдельный поход в
    // базу, и ответы возвращаются вперемешку.
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  const items = page?.items ?? [];
  const total = page?.total ?? 0;

  return (
    <Card>
      <CardHeader
        title="Движения"
        description={
          loading
            ? 'Загружаю…'
            : `Продажи, списания при записи, возвраты при отмене и ручные корректировки — ${total} ${plural(total, 'движение', 'движения', 'движений')}. Журнал только пополняется: ошибку поправляют новой корректировкой с причиной.`
        }
      />
      <CardBody>
        {error && <Alert>{error}</Alert>}

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

        <Pager total={total} offset={offset} shown={items.length} loading={loading} onOffset={setOffset} />
      </CardBody>
    </Card>
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

/* ==========================================================================
   Общее
   ========================================================================== */

function Pager({
  total,
  offset,
  shown,
  loading,
  onOffset,
}: {
  total: number;
  offset: number;
  shown: number;
  loading: boolean;
  onOffset: (offset: number) => void;
}) {
  if (total <= PAGE_SIZE) return null;

  return (
    <div className="mt-4 flex items-center gap-3">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={offset === 0 || loading}
        onClick={() => onOffset(Math.max(0, offset - PAGE_SIZE))}
      >
        Назад
      </Button>
      <span className="text-[0.8125rem] text-text-subtle">
        {offset + 1}–{offset + shown} из {total}
      </span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={offset + PAGE_SIZE >= total || loading}
        onClick={() => onOffset(offset + PAGE_SIZE)}
      >
        Дальше
      </Button>
    </div>
  );
}

/** «3 окт. 2026». */
function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}
