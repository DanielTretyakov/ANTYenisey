'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ClubField } from '@/components/ClubField';
import { PhoneField } from '@/components/PhoneField';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
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
        birthDate: String(form.get('birthDate')),
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
      title="Регистрация"
      subtitle="Одна анкета — и запись на тренировки, столы и турниры открыта."
      footer={
        <>
          Уже есть учётная запись?{' '}
          <Link href="/login" className="font-medium text-text-accent hover:underline">
            Войти
          </Link>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}

      <form onSubmit={handleSubmit}>
        <ClubField />

        <Field label="Фамилия" name="lastName" autoComplete="family-name" required />
        <Field label="Имя" name="firstName" autoComplete="given-name" required />
        <Field label="Отчество" name="middleName" autoComplete="additional-name" required />

        <PhoneField />

        <Field
          label="Дата рождения"
          name="birthDate"
          type="date"
          autoComplete="bday"
          hint="Нужна для детских групп и возрастных турниров."
          required
        />

        <Field label="Электронная почта" name="email" type="email" autoComplete="email" required />

        <Field
          label="Пароль"
          name="password"
          type="password"
          minLength={8}
          autoComplete="new-password"
          hint="Не короче 8 символов"
          required
        />

        <Button type="submit" pending={pending} fullWidth size="lg" className="mt-2">
          {pending ? 'Отправляю…' : 'Зарегистрироваться'}
        </Button>
      </form>
    </AuthLayout>
  );
}
