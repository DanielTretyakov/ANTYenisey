'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ClubField } from '@/components/ClubField';
import { PhoneField } from '@/components/PhoneField';
import { api, ApiError } from '@/lib/api';
import { TENANT_SLUG } from '@/lib/config';
import { saveSession } from '@/lib/session';

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const phone = String(form.get('phone'));

    // Скрытое поле телефона пустеет, пока не набраны все десять цифр —
    // проверяем до отправки, чтобы человек не ждал ответа сервера ради
    // ошибки, которая видна сразу.
    if (!phone) {
      setError('Введите номер телефона полностью — десять цифр');
      return;
    }

    setPending(true);

    try {
      const auth = await api.register({
        tenantSlug: TENANT_SLUG,
        email: String(form.get('email')),
        password: String(form.get('password')),
        lastName: String(form.get('lastName')),
        firstName: String(form.get('firstName')),
        middleName: String(form.get('middleName')),
        phone,
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
      <h1>Регистрация</h1>

      {error && <p className="error">{error}</p>}

      <form onSubmit={handleSubmit}>
        <ClubField />

        <label>
          Фамилия
          <input name="lastName" autoComplete="family-name" required />
        </label>

        <label>
          Имя
          <input name="firstName" autoComplete="given-name" required />
        </label>

        <label>
          Отчество
          <input name="middleName" autoComplete="additional-name" required />
        </label>

        <PhoneField />

        <label>
          Электронная почта
          <input name="email" type="email" autoComplete="email" required />
        </label>

        <label>
          Пароль
          <input
            name="password"
            type="password"
            minLength={8}
            autoComplete="new-password"
            required
          />
          <span className="field-hint">Не короче 8 символов</span>
        </label>

        <button type="submit" disabled={pending}>
          {pending ? 'Отправляю…' : 'Зарегистрироваться'}
        </button>
      </form>

      <p className="hint">
        Уже есть учётная запись? <Link href="/login">Войти</Link>
      </p>
    </main>
  );
}
