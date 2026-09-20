'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ClientSubscription } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { remainingLabel, validUntilLabel } from '@/lib/subscriptions';

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

  // Пустой блок в кабинете того, у кого абонементов нет и не было, — шум.
  if (subscriptions?.length === 0 && !error) {
    return null;
  }

  return (
    <Card className="mt-6 max-w-2xl">
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
                <p className="text-[0.9375rem] font-medium">
                  {sub.planName}
                  {!sub.active && <span className="ml-2 text-[0.8125rem] font-normal">· не действует</span>}
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
