'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ClubField } from '@/components/ClubField';
import { api, ApiError } from '@/lib/api';
import { TENANT_SLUG } from '@/lib/config';
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
      const auth = await api.login({
        tenantSlug: TENANT_SLUG,
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
    <main>
      <h1>Вход</h1>

      {error && <p className="error">{error}</p>}

      <form onSubmit={handleSubmit}>
        <ClubField />

        <label>
          Электронная почта
          <input name="email" type="email" autoComplete="email" required />
        </label>

        <label>
          Пароль
          <input name="password" type="password" autoComplete="current-password" required />
        </label>

        <button type="submit" disabled={pending}>
          {pending ? 'Проверяю…' : 'Войти'}
        </button>
      </form>

      <p className="hint">
        Нет учётной записи? <Link href="/register">Зарегистрироваться</Link>
      </p>
    </main>
  );
}
