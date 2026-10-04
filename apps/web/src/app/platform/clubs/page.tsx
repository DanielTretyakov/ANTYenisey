'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ClubApplicationView, PlatformClubRow, PlatformStatus } from '@yenisey/types';
import { AppShell } from '@/components/layout/AppShell';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Tab } from '@/components/ui/Tab';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatKopecks } from '@/lib/money';
import { plural } from '@/lib/plural';
import { useSession } from '@/lib/useSession';
import { ApplicationsTab } from './ApplicationsTab';

/** Вкладка «Заявки» — в адресе: на неё ведёт ссылка из сообщения в MAX. */
const APPLICATIONS_HASH = 'zayavki';

const STATUS: Record<PlatformStatus, { label: string; tone: string }> = {
  TRIAL: { label: 'пробный период', tone: 'bg-surface-sunken text-text-muted' },
  ACTIVE: { label: 'активна', tone: 'bg-surface-accent-soft text-text-accent' },
  PAST_DUE: { label: 'не оплачена', tone: 'bg-warning-soft text-warning' },
  SUSPENDED: { label: 'приостановлена', tone: 'bg-danger-soft text-danger' },
  EXEMPT: { label: 'без оплаты', tone: 'bg-surface-sunken text-text-muted' },
};

function day(iso: string | null): string {
  return iso ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso)) : '—';
}

/**
 * «Клубы и подписки» владельца платформы — минимальная роль администратора
 * платформы из ТЗ: статусы клубов, отметка оплаченного счёта, «без оплаты»,
 * продление вручную. Рядом — заявки клубов на подключение (решение от
 * 03.10.2026).
 */
export default function PlatformClubsPage() {
  const session = useSession();
  const router = useRouter();
  const owner = session.status === 'ready' && session.user.platformOwner;
  const [rows, setRows] = useState<PlatformClubRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [applications, setApplications] = useState<ClubApplicationView[] | null>(null);
  const [tab, setTab] = useState<'clubs' | 'applications'>('clubs');

  useEffect(() => {
    if (session.status === 'anonymous') router.replace('/login?next=/platform/clubs');
  }, [session.status, router]);

  // Вкладка — из якоря, в эффекте: на сервере адреса нет.
  useEffect(() => {
    if (window.location.hash.slice(1) === APPLICATIONS_HASH) setTab('applications');
  }, []);

  useEffect(() => {
    if (!owner) return;
    api
      .platformClubs()
      .then(setRows)
      .catch((cause: unknown) => setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен'));
    api
      .clubApplications()
      .then(setApplications)
      .catch((cause: unknown) => setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен'));
  }, [owner]);

  function choose(next: 'clubs' | 'applications'): void {
    setTab(next);
    window.history.replaceState(null, '', next === 'applications' ? `#${APPLICATIONS_HASH}` : window.location.pathname);
  }

  const fresh = applications?.filter((item) => item.status === 'NEW').length ?? 0;

  async function run(key: string, action: () => Promise<PlatformClubRow[]>): Promise<void> {
    setPending(key);
    setError(null);

    try {
      setRows(await action());
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(null);
    }
  }

  return (
    <AppShell footer="line">
      <h1 className="mb-2 text-[1.75rem]">Клубы и подписки</h1>
      <p className="mb-7 max-w-2xl text-[0.9375rem] text-text-muted">
        Подписка каждого клуба на КНТ. Счёт оплачен — отметьте, и доступ продлится; договорились подождать — продлите
        вручную.
      </p>

      {session.status === 'ready' && !owner && <Alert>Раздел доступен только владельцу платформы.</Alert>}
      {error && <Alert>{error}</Alert>}

      {owner && (
        <div className="mb-5 flex gap-1.5" role="tablist" aria-label="Раздел">
          <Tab inTablist active={tab === 'clubs'} onClick={() => choose('clubs')} badge={rows?.length}>
            Клубы
          </Tab>
          <Tab inTablist active={tab === 'applications'} onClick={() => choose('applications')} badge={fresh > 0 ? `${fresh} ${plural(fresh, 'новая', 'новые', 'новых')}` : undefined}>
            Заявки
          </Tab>
        </div>
      )}

      {tab === 'applications' && applications && (
        <ApplicationsTab
          items={applications}
          onChange={(changed) => setApplications((list) => list?.map((item) => (item.id === changed.id ? changed : item)) ?? null)}
        />
      )}

      {tab === 'clubs' && rows && (
        <div className="overflow-x-auto rounded-card border border-border bg-surface-raised">
          <table className="w-full min-w-[52rem] border-collapse text-[0.875rem]">
            <thead>
              <tr className="text-left text-[0.75rem] tracking-[0.06em] text-text-subtle uppercase">
                <th className="px-4 py-3 font-semibold">Клуб</th>
                <th className="px-4 py-3 font-semibold">Статус</th>
                <th className="px-4 py-3 font-semibold">Срок</th>
                <th className="px-4 py-3 font-semibold">Оплата</th>
                <th className="px-4 py-3 font-semibold">Действия</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const status = STATUS[row.status];
                const until =
                  row.status === 'TRIAL'
                    ? `до ${day(row.trialEndsAt)}`
                    : row.status === 'PAST_DUE'
                      ? `закроется ${day(row.graceUntil)}`
                      : row.paidUntil
                        ? `до ${day(row.paidUntil)}`
                        : '—';

                return (
                  <tr key={row.slug} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      <Link href={`/clubs/${row.slug}`} className="text-text underline-offset-2 hover:underline">
                        {row.name}
                      </Link>
                      {row.planName && <span className="block text-[0.8125rem] text-text-muted">тариф «{row.planName}»</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-[0.75rem] font-semibold', status.tone)}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{until}</td>
                    <td className="px-4 py-3">
                      {row.pendingInvoice
                        ? `счёт № ${row.pendingInvoice.number} на ${formatKopecks(row.pendingInvoice.amount)}`
                        : (row.paymentMethodTitle ?? '—')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {row.pendingInvoice && (
                          <Button
                            size="sm"
                            pending={pending === `paid:${row.slug}`}
                            disabled={pending !== null}
                            onClick={() => void run(`paid:${row.slug}`, () => api.markInvoicePaid(row.pendingInvoice!.paymentId))}
                          >
                            Счёт оплачен
                          </Button>
                        )}
                        {row.status !== 'EXEMPT' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            pending={pending === `extend:${row.slug}`}
                            disabled={pending !== null}
                            onClick={() => void run(`extend:${row.slug}`, () => api.extendClub(row.slug, 7))}
                          >
                            +7 дней
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          pending={pending === `exempt:${row.slug}`}
                          disabled={pending !== null}
                          onClick={() => void run(`exempt:${row.slug}`, () => api.setClubExempt(row.slug, row.status !== 'EXEMPT'))}
                        >
                          {row.status === 'EXEMPT' ? 'Снять «без оплаты»' : 'Без оплаты'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
