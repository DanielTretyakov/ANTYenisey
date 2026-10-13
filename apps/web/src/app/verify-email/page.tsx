'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Alert } from '@/components/ui/Alert';
import { api, ApiError } from '@/lib/api';

/**
 * Подтверждение почты по ссылке из письма (12.10.2026). Без входа: письмо
 * открывают и на телефоне, где человек не вошёл. Токен — из адреса, в
 * эффекте, без `useSearchParams` и границы Suspense.
 */
export default function VerifyEmailPage() {
  const [state, setState] = useState<'pending' | 'done' | 'error'>('pending');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');

    if (!token) {
      setState('error');
      setError('В ссылке нет ключа — откройте её из письма целиком.');
      return;
    }

    api
      .verifyEmail(token)
      .then(() => setState('done'))
      .catch((cause: unknown) => {
        setState('error');
        setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен, попробуйте позже');
      });
  }, []);

  return (
    <AuthLayout title="Подтверждение почты" subtitle="Один аккаунт на все клубы платформы.">
      {state === 'pending' && <p className="text-[0.9375rem] text-text-muted">Проверяем ссылку…</p>}
      {state === 'done' && (
        <>
          <Alert tone="info">Почта подтверждена. Спасибо!</Alert>
          <p className="text-[0.9375rem]">
            <Link href="/cabinet" className="font-medium text-text-accent hover:underline">
              Перейти в кабинет
            </Link>
          </p>
        </>
      )}
      {state === 'error' && (
        <>
          <Alert>{error}</Alert>
          <p className="text-[0.9375rem] text-text-muted">
            Новое письмо можно отправить из{' '}
            <Link href="/cabinet/edit/profile" className="font-medium text-text-accent hover:underline">
              личных данных в кабинете
            </Link>
            .
          </p>
        </>
      )}
    </AuthLayout>
  );
}
