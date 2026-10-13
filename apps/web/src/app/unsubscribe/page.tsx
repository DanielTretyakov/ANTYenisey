'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Alert } from '@/components/ui/Alert';
import { api, ApiError } from '@/lib/api';

/**
 * Отписка от рассылки КНТ по ссылке из письма (12.10.2026, 38-ФЗ): в одно
 * нажатие и без входа. Письма о самой учётке и о деньгах клуба приходят
 * по-прежнему — это не рассылка.
 */
export default function UnsubscribePage() {
  const [state, setState] = useState<'pending' | 'done' | 'error'>('pending');
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('t') ?? '';

    api
      .unsubscribe(token)
      .then((result) => {
        setEmail(result.email);
        setState('done');
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен, попробуйте позже');
        setState('error');
      });
  }, []);

  return (
    <AuthLayout title="Отписка от рассылки" subtitle="Новости КНТ на почту.">
      {state === 'pending' && <p className="text-[0.9375rem] text-text-muted">Отписываем…</p>}
      {state === 'done' && (
        <>
          <Alert tone="info">Готово: новости КНТ на {email} больше не придут.</Alert>
          <p className="text-[0.9375rem] text-text-muted">
            Письма о вашей учётке и о деньгах клуба приходят по-прежнему. Вернуть рассылку можно в{' '}
            <Link href="/cabinet/edit/notifications" className="font-medium text-text-accent hover:underline">
              уведомлениях кабинета
            </Link>
            .
          </p>
        </>
      )}
      {state === 'error' && <Alert>{error}</Alert>}
    </AuthLayout>
  );
}
