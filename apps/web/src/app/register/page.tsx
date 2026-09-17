'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { ClubField } from '@/components/ClubField';
import { PhoneField } from '@/components/PhoneField';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';
import { isChildBirthDate } from '@/lib/family';
import { saveSession } from '@/lib/session';

/**
 * Регистрация.
 *
 * Аккаунт заводится НА ПЛАТФОРМЕ, а не в клубе: почта уникальна по всей
 * платформе, и вступать куда-либо, чтобы пользоваться учёткой, не нужно.
 * Поэтому клуб здесь не спрашивается и по умолчанию не подставляется.
 *
 * Исключение — приход со страницы клуба: тогда его код лежит в адресе
 * (`?club=yenisey`), показывается человеку и уходит в запрос, и человек сразу
 * становится клиентом этого клуба. Без кода привязка появится сама, первой же
 * записью.
 */
/**
 * Обёртка с Suspense.
 *
 * Форма читает код клуба из строки запроса через useSearchParams, а он на
 * сервере неизвестен: Next требует границу Suspense, иначе сборка падает на
 * пререндере. Запасной вид — та же разметка без формы, чтобы полоса шапки и
 * разворот входа не мигали.
 */
export default function RegisterPage() {
  return (
    <Suspense fallback={<RegisterForm clubSlug={null} />}>
      <RegisterFormFromQuery />
    </Suspense>
  );
}

function RegisterFormFromQuery() {
  const params = useSearchParams();

  return <RegisterForm clubSlug={params.get('club')} />;
}

function RegisterForm({ clubSlug }: { clubSlug: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [birthDate, setBirthDate] = useState('');

  // Младше 16 регистрироваться можно — учётка ребёнку нужна, чтобы видеть свои
  // записи, — но записывать его будет родитель. Сказать это надо до отправки,
  // а не на первой же кнопке «Записаться».
  const child = /^\d{4}-\d{2}-\d{2}$/.test(birthDate) && isChildBirthDate(birthDate);

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
        ...(clubSlug ? { tenantSlug: clubSlug } : {}),
        email: String(form.get('email')),
        password: String(form.get('password')),
        lastName: String(form.get('lastName')),
        firstName: String(form.get('firstName')),
        middleName: String(form.get('middleName')),
        phone,
        birthDate: String(form.get('birthDate')),
      });

      saveSession(auth);
      router.push(clubSlug ? `/clubs/${clubSlug}` : '/');
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
        {clubSlug && <ClubField slug={clubSlug} />}

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
          value={birthDate}
          onChange={(event) => setBirthDate(event.target.value)}
        />

        {child && (
          <Alert tone="info">
            До 16 лет на занятия и турниры записывает родитель. Зарегистрироваться можно, а потом
            попросите родителя закрепить вашу учётку у себя в кабинете — или администратора у стойки клуба.
          </Alert>
        )}

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
