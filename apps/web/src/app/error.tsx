'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';

/**
 * Страница сбоя — своя, по-русски (аудит 03.10.2026): без неё упавшая
 * страница показывала заглушку Next без выхода никуда. Повтор перерисовывает
 * страницу, не перезагружая сайт.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <AppShell>
      <div className="grid max-w-xl gap-4">
        <p className="text-[0.75rem] font-semibold tracking-[0.1em] text-text-subtle uppercase">Сбой</p>
        <h1 className="font-display text-[2rem] leading-tight">Страница не открылась</h1>
        <p className="text-[1rem] text-text-muted">
          Что-то пошло не так у нас, а не у вас. Попробуйте ещё раз; если не выйдет — вернитесь чуть позже.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Button onClick={reset}>Попробовать ещё раз</Button>
          <Link href="/" className="text-[0.9375rem] text-text-accent underline underline-offset-2">
            На стартовую
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
