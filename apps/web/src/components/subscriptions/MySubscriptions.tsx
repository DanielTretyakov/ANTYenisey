'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ClientSubscription, SubscriptionOffer } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { plural } from '@/lib/plural';
import { subscriptionAlert, type AlertLevel } from '@/lib/subscriptionAlert';
import { formatKopecks } from '@/lib/money';
import { remainingLabel, subscriptionAlertLabel, validUntilLabel } from '@/lib/subscriptions';

/**
 * Абонементы в кабинете — по всем клубам сразу.
 *
 * Купить здесь пока нельзя: абонемент продаёт администратор у стойки, онлайн-
 * покупка появится вместе с платёжным шлюзом. Родитель видит абонементы
 * ребёнка тем же блоком — `forPerson` приходит из переключателя «действую за».
 */
export function MySubscriptions({ forPerson }: { forPerson: string | null }) {
  const [subscriptions, setSubscriptions] = useState<ClientSubscription[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .mySubscriptions(forPerson)
      .then((loaded) => {
        if (!cancelled) setSubscriptions(loaded);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером');
      });

    return () => {
      cancelled = true;
    };
  }, [forPerson]);

  // Абонементов нет — не пустота, а предложение (решение владельца от
  // 25.09.2026): тарифы клубов человека и как их купить.
  if (subscriptions?.length === 0 && !error) {
    return <NoSubscriptions forPerson={forPerson} />;
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader
        title="Абонементы"
        description="Оплачивают записи сами: визит списывается при записи и возвращается при отмене. Купить абонемент можно у стойки клуба."
      />
      <CardBody>
        {error && <Alert>{error}</Alert>}

        {subscriptions && (
          <ul className="divide-y divide-border">
            {subscriptions.map((sub) => (
              <li key={sub.id} className={cn('py-3 first:pt-0 last:pb-0', !sub.active && 'text-text-subtle')}>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.9375rem] font-medium">
                  {sub.planName}
                  {!sub.active && <span className="text-[0.8125rem] font-normal">· не действует</span>}
                  <EndingBadge sub={sub} />
                </p>
                <p className="mt-0.5 text-[0.875rem] text-text-muted">
                  {remainingLabel(sub.remainingVisits)} · {validUntilLabel(sub.expiresAt)} ·{' '}
                  <Link href={`/clubs/${sub.club.slug}`} className="text-text-accent underline-offset-2 hover:underline">
                    {sub.club.name}
                  </Link>
                </p>
                <p className="mt-0.5 text-[0.8125rem] text-text-subtle">{sub.covers.join(', ')}</p>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/** Цвет плашки по срочности: последний визит или день — тревожнее прочего. */
const BADGE: Record<AlertLevel, string> = {
  last: 'border-warning-border bg-warning-soft text-warning',
  near: 'border-warning-border bg-warning-soft text-warning',
  soon: 'border-border-accent bg-surface-accent-soft text-text-accent',
};

/**
 * «Осталось всего 3 визита», «сегодня последний день».
 *
 * Плашка у самого абонемента, а не общим сообщением сверху: у человека их
 * бывает несколько, и «что-то кончается» без указания чего — не подсказка.
 */
function EndingBadge({ sub }: { sub: ClientSubscription }) {
  const alert = subscriptionAlert(sub, new Date());

  if (!alert) {
    return null;
  }

  return (
    <span className={cn('rounded-full border px-2 py-px text-[0.75rem] font-normal', BADGE[alert.level])}>
      {subscriptionAlertLabel(alert)}
    </span>
  );
}

/**
 * Абонементов нет: так и сказано, а ниже — тарифы клубов человека. Купить
 * онлайн пока нельзя (оплата появится вместе с платёжным шлюзом), поэтому
 * рядом с тарифами — телефон клуба и «у администратора».
 */
function NoSubscriptions({ forPerson }: { forPerson: string | null }) {
  const [offers, setOffers] = useState<SubscriptionOffer[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .mySubscriptionOffers(forPerson)
      .then((loaded) => {
        if (!cancelled) setOffers(loaded);
      })
      .catch(() => {
        if (!cancelled) setOffers([]);
      });

    return () => {
      cancelled = true;
    };
  }, [forPerson]);

  return (
    <Card className="max-w-2xl">
      <CardHeader
        title="Абонементы"
        description="Абонемент оплачивает записи сам: визит списывается при записи и возвращается при отмене."
      />
      <CardBody>
        <p className="text-[0.9375rem] text-text">Абонементов пока нет.</p>

        {offers === null && <p className="mt-3 text-[0.875rem] text-text-muted">Загружаю тарифы…</p>}

        {offers?.length === 0 && (
          <p className="mt-2 text-[0.875rem] text-text-muted">
            В ваших клубах тарифов пока нет.{' '}
            <Link href="/" className="text-text-accent underline-offset-2 hover:underline">
              Найдите клуб
            </Link>{' '}
            и отметьте его своим — его абонементы появятся здесь.
          </p>
        )}

        {offers && offers.length > 0 && (
          <div className="mt-5 grid gap-6">
            <p className="text-[0.875rem] text-text-muted">
              Купить абонемент можно у администратора клуба — онлайн-оплата появится позже.
            </p>

            {offers.map((offer) => (
              <section key={offer.club.slug}>
                <h3 className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[0.9375rem] font-medium">
                  <Link href={`/clubs/${offer.club.slug}`} className="underline-offset-2 hover:underline">
                    {offer.club.name}
                  </Link>
                  {offer.club.phone && (
                    <a
                      href={`tel:${offer.club.phone}`}
                      className="text-[0.875rem] font-normal text-text-accent underline-offset-2 hover:underline"
                    >
                      {offer.club.phone}
                    </a>
                  )}
                </h3>

                <ul className="mt-2 divide-y divide-border rounded-control border border-border">
                  {offer.plans.map((plan) => (
                    <li key={plan.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
                      <span className="min-w-0 grow">
                        <span className="block text-[0.9375rem] text-text">{plan.name}</span>
                        <span className="block text-[0.8125rem] text-text-muted">
                          {planTerms(plan)}
                          {plan.covers.length > 0 && ` · ${plan.covers.join(', ')}`}
                        </span>
                      </span>
                      <span className="text-[0.9375rem] whitespace-nowrap text-text">{formatKopecks(plan.price)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** «8 визитов · 30 дней», «безлимит · бессрочно». */
function planTerms(plan: SubscriptionOffer['plans'][number]): string {
  const visits = plan.visitsCount === null ? 'безлимит' : `${plan.visitsCount} ${plural(plan.visitsCount, 'визит', 'визита', 'визитов')}`;
  const days = plan.durationDays === null ? 'бессрочно' : `${plan.durationDays} ${plural(plan.durationDays, 'день', 'дня', 'дней')}`;

  return `${visits} · ${days}`;
}
