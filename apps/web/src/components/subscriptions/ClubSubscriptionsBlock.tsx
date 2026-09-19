'use client';

import { useState, type FormEvent } from 'react';
import type { ClientSubscription, SubscriptionLedgerRow, SubscriptionPlan } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatKopecks } from '@/lib/money';
import { planTermsLabel, remainingLabel, validUntilLabel } from '@/lib/subscriptions';
import { useClubApi } from '@/lib/useClubApi';

function messageOf(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером';
}

/**
 * Абонементы человека в карточке у администратора.
 *
 * Продажа — здесь же: клиент платит у стойки как угодно, а администратор
 * выдаёт абонемент выбранного тарифа. Возврат абонемента — корректировка
 * визитов до нуля с причиной (решение владельца от 19.09.2026); безлимит
 * закрывается досрочно.
 */
export function ClubSubscriptionsBlock({
  personId,
  subscriptions,
  onChanged,
}: {
  personId: string;
  subscriptions: ClientSubscription[];
  onChanged: () => void;
}) {
  const club = useClubApi();
  const [plans, setPlans] = useState<SubscriptionPlan[] | null>(null);
  const [planId, setPlanId] = useState('');
  const [selling, setSelling] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openSale(): Promise<void> {
    setError(null);
    setSelling(true);

    try {
      const loaded = (await club.subscriptionPlans()).filter((plan) => plan.isActive);
      setPlans(loaded);
      setPlanId(loaded[0]?.id ?? '');
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  async function sell(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await club.issueSubscription(personId, planId);
      setSelling(false);
      onChanged();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  }

  const chosen = plans?.find((plan) => plan.id === planId) ?? null;

  return (
    <Card>
      <CardHeader
        title="Абонементы"
        description="Оплачивают записи на занятия и турниры, которые покрывает тариф: визит списывается при записи и возвращается при отмене."
      />
      <CardBody className="grid gap-5">
        {error && <Alert>{error}</Alert>}

        {subscriptions.length === 0 ? (
          <p className="text-[0.9375rem] text-text-muted">Абонементов нет.</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {subscriptions.map((sub) => (
              <SubscriptionRow key={sub.id} personId={personId} sub={sub} onChanged={onChanged} />
            ))}
          </ul>
        )}

        {!selling ? (
          <div>
            <Button variant="secondary" onClick={() => void openSale()}>
              Продать абонемент
            </Button>
          </div>
        ) : plans !== null && plans.length === 0 ? (
          <Alert tone="info">
            Тарифов в продаже нет — заведите их в разделе «Занятия и турниры».
          </Alert>
        ) : (
          plans && (
            <form onSubmit={(event) => void sell(event)} className="rounded-control border border-border p-4">
              <Select
                label="Тариф"
                value={planId}
                onChange={(event) => setPlanId(event.target.value)}
                options={plans.map((plan) => ({
                  value: plan.id,
                  label: `${plan.name} — ${planTermsLabel(plan.visitsCount, plan.durationDays)}, ${formatKopecks(plan.price)}`,
                }))}
              />
              {chosen && (
                <p className="mb-4 text-[0.875rem] text-text-muted">
                  К оплате у стойки: <span className="text-text">{formatKopecks(chosen.price)}</span>. Деньги
                  принимаются вне системы; срок пойдёт с сегодняшнего дня.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" pending={pending} disabled={!planId}>
                  Продать
                </Button>
                <Button type="button" variant="ghost" onClick={() => setSelling(false)}>
                  Отмена
                </Button>
              </div>
            </form>
          )
        )}
      </CardBody>
    </Card>
  );
}

function SubscriptionRow({
  personId,
  sub,
  onChanged,
}: {
  personId: string;
  sub: ClientSubscription;
  onChanged: () => void;
}) {
  const club = useClubApi();
  const [adjusting, setAdjusting] = useState(false);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [ledger, setLedger] = useState<SubscriptionLedgerRow[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlimited = sub.remainingVisits === null;

  async function adjust(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await club.adjustSubscription(
        personId,
        sub.id,
        unlimited ? { close: true, reason } : { delta: Number(delta), reason },
      );
      setAdjusting(false);
      setDelta('');
      setReason('');
      setLedger(null);
      onChanged();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  }

  async function toggleLedger(): Promise<void> {
    if (ledger) {
      setLedger(null);
      return;
    }

    try {
      setLedger(await club.subscriptionLedger(personId, sub.id));
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        {/* Минимальная ширина — чтобы на узком экране кнопки ушли вниз, а не
            сжали текст до слова в строку. */}
        <div className={cn('min-w-[12rem] flex-1', !sub.active && 'text-text-subtle')}>
          <p className="text-[0.9375rem] font-medium">
            {sub.planName}
            {!sub.active && <span className="ml-2 text-[0.8125rem] font-normal">· не действует</span>}
          </p>
          <p className="mt-0.5 text-[0.875rem] text-text-muted">
            {remainingLabel(sub.remainingVisits)} · {validUntilLabel(sub.expiresAt)} · продан за{' '}
            {formatKopecks(sub.priceAtPurchase)}
          </p>
          <p className="mt-0.5 text-[0.8125rem] text-text-subtle">{sub.covers.join(', ')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {sub.active && (
            <Button size="sm" variant="ghost" onClick={() => setAdjusting(!adjusting)}>
              {unlimited ? 'Закрыть досрочно…' : 'Скорректировать…'}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void toggleLedger()}>
            {ledger ? 'Скрыть историю' : 'История'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}

      {adjusting && (
        <form onSubmit={(event) => void adjust(event)} className="mt-3 rounded-control border border-border p-4">
          {!unlimited && (
            <Field
              label="Сколько визитов"
              hint="Со знаком: −2 — списать два, 3 — добавить три. Возврат абонемента — списание до нуля."
              type="number"
              value={delta}
              required
              onChange={(event) => setDelta(event.target.value)}
            />
          )}
          <Field
            label="Причина — её увидят в истории абонемента"
            value={reason}
            required
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              variant={unlimited ? 'danger' : 'primary'}
              pending={pending}
              disabled={reason.trim() === '' || (!unlimited && (delta === '' || Number(delta) === 0))}
            >
              {unlimited ? 'Закрыть абонемент' : 'Скорректировать'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdjusting(false)}>
              Отмена
            </Button>
          </div>
        </form>
      )}

      {ledger && (
        <ul className="mt-3 grid gap-1.5 text-[0.8125rem]">
          {ledger.map((row) => (
            <li key={row.id} className="flex flex-wrap gap-x-3">
              <span className="w-28 shrink-0 tabular-nums text-text-muted">
                {new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(
                  new Date(row.at),
                )}
              </span>
              <span className="w-10 shrink-0 tabular-nums">{row.delta > 0 ? `+${row.delta}` : row.delta}</span>
              <span className="min-w-0 flex-1 break-words text-text-muted">{ledgerLabel(row)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function ledgerLabel(row: SubscriptionLedgerRow): string {
  const entry = row.entry
    ? `${row.entry.title}, ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(row.entry.startsAt))}`
    : '';

  switch (row.reason) {
    case 'PURCHASE':
      return `Продан${row.by ? ` · ${row.by}` : ''}`;
    case 'VISIT_CHARGED':
      return `Запись: ${entry}`;
    case 'VISIT_REFUNDED':
      return `Возврат: ${entry}`;
    case 'ADMIN_ADJUSTMENT':
      return `${row.delta === 0 ? 'Закрыт досрочно' : 'Корректировка'}: ${row.note ?? ''}${row.by ? ` · ${row.by}` : ''}`;
  }
}
