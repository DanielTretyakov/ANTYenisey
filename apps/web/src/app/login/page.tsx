'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api';
import { useMailEnabled } from '@/lib/mailStatus';
import { registerHref, safeNext } from '@/lib/next';
import { saveSession } from '@/lib/session';
import { useSession } from '@/lib/useSession';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Куда вернуть после входа: окно мероприятия и сетка брони отправляют
  // сюда анонима и ждут его обратно. Из адреса в эффекте, а не через
  // `useSearchParams`: тому нужна граница Suspense на всю страницу.
  const [next, setNext] = useState<string | null>(null);
  // «Забыли пароль?» — только когда почта сервиса работает (12.10.2026).
  const mailEnabled = useMailEnabled();
  const session = useSession();

  useEffect(() => {
    setNext(safeNext(new URLSearchParams(window.location.search).get('next')));
  }, []);

  // Уже вошедшему форма входа ни к чему — туда, куда он шёл.
  useEffect(() => {
    if (session.status === 'ready' && !pending) {
      router.replace(safeNext(new URLSearchParams(window.location.search).get('next')) ?? '/cabinet');
    }
    // pending — только чтобы не перебивать переход после собственного входа.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.status, router]);

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
      router.push(next ?? '/cabinet');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен, попробуйте позже');
      setPending(false);
    }
  }

  return (
    <AuthLayout
      title="Вход"
      subtitle="Один аккаунт на все клубы платформы."
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

        {mailEnabled && (
          <p className="-mt-2 mb-3 text-right text-[0.875rem]">
            <Link href="/forgot-password" className="text-text-accent hover:underline">
              Забыли пароль?
            </Link>
          </p>
        )}

        <Button type="submit" pending={pending} fullWidth size="lg" className="mt-2">
          {pending ? 'Проверяем…' : 'Войти'}
        </Button>
      </form>

      {/* «Войти и записаться» приводит сюда и новичка — ему нужна регистрация,
          а не мелкая ссылка в подвале формы (прогон 28.10.2026). */}
      <div className="mt-6 border-t border-border pt-5 text-center">
        <p className="mb-3 text-[0.875rem] text-text-muted">Впервые на КНТ?</p>
        <Link href={registerHref(next)} className="block">
          <Button variant="secondary" fullWidth size="lg">
            Создать аккаунт
          </Button>
        </Link>
      </div>
    </AuthLayout>
  );
}
