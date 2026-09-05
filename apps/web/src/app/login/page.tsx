'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';
import { saveSession } from '@/lib/session';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);

    try {
      // Клуб в запрос не уходит: вход — на платформу, почта уникальна глобально.
      const auth = await api.login({
        email: String(form.get('email')),
        password: String(form.get('password')),
      });

      saveSession(auth);
      router.push('/cabinet');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен, попробуйте позже');
      setPending(false);
    }
  }

  return (
    <AuthLayout
      title="Вход"
      subtitle="Один аккаунт на все клубы платформы."
      footer={
        <>
          Нет учётной записи?{' '}
          <Link href="/register" className="font-medium text-text-accent hover:underline">
            Зарегистрироваться
          </Link>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}

      <form onSubmit={handleSubmit} noValidate={false}>
        <Field label="Электронная почта" name="email" type="email" autoComplete="email" required />

        <Field
          label="Пароль"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />

        <Button type="submit" pending={pending} fullWidth size="lg" className="mt-2">
          {pending ? 'Проверяю…' : 'Войти'}
        </Button>
      </form>
    </AuthLayout>
  );
}
