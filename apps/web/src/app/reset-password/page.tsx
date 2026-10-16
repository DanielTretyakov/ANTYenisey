'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';
import { saveSession } from '@/lib/session';

/**
 * Новый пароль по ссылке из письма (12.10.2026): ссылка одна, на час.
 * После смены сервер гасит все прежние сессии и сразу входит этой.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token'));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const password = String(form.get('password'));

    if (password !== String(form.get('repeat'))) {
      setError('Пароли не совпадают');
      return;
    }

    setPending(true);

    try {
      saveSession(await api.resetPassword(token ?? '', password));
      router.push('/cabinet');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен, попробуйте позже');
      setPending(false);
    }
  }

  return (
    <AuthLayout
      title="Новый пароль"
      subtitle="После смены пароля вы выйдете из аккаунта на всех устройствах."
      footer={
        <Link href="/forgot-password" className="font-medium text-text-accent hover:underline">
          Запросить новую ссылку
        </Link>
      }
    >
      {error && <Alert>{error}</Alert>}

      <form onSubmit={handleSubmit}>
        <Field label="Новый пароль" name="password" type="password" autoComplete="new-password" minLength={8} required hint="Не короче 8 символов." />
        <Field label="Ещё раз" name="repeat" type="password" autoComplete="new-password" minLength={8} required />
        <Button type="submit" pending={pending} disabled={!token} fullWidth size="lg" className="mt-2">
          Сохранить и войти
        </Button>
      </form>
    </AuthLayout>
  );
}
