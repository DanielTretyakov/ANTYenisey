'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';

/**
 * «Забыли пароль?» (12.10.2026). Ответ одинаковый при любом исходе — есть
 * такая почта или нет: иначе форма выдавала бы, кто зарегистрирован.
 */
export default function ForgotPasswordPage() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);

    const email = String(new FormData(event.currentTarget).get('email')).trim();

    try {
      await api.forgotPassword(email);
      setSent(email);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен, попробуйте позже');
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout
      title="Восстановление пароля"
      subtitle="Пришлём ссылку для нового пароля на почту, с которой вы регистрировались."
      footer={
        <Link href="/login" className="font-medium text-text-accent hover:underline">
          Вернуться ко входу
        </Link>
      }
    >
      {error && <Alert>{error}</Alert>}

      {sent ? (
        <Alert tone="info">
          Если аккаунт с почтой {sent} есть, письмо со ссылкой уже в пути. Ссылка действует один час. Если письма
          нет, проверьте папку «Спам».
        </Alert>
      ) : (
        <form onSubmit={handleSubmit}>
          <Field label="Электронная почта" name="email" type="email" autoComplete="email" required />
          <Button type="submit" pending={pending} fullWidth size="lg" className="mt-2">
            Прислать ссылку
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
