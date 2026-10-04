import Link from 'next/link';
import { AppShell } from '@/components/layout/AppShell';

/**
 * Страница «не найдено» — своя, по-русски и с шапкой сайта (аудит
 * 03.10.2026): заглушка Next была английской и без выхода никуда.
 */
export default function NotFound() {
  return (
    <AppShell>
      <div className="grid max-w-xl gap-4">
        <p className="text-[0.75rem] font-semibold tracking-[0.1em] text-text-subtle uppercase">Ошибка 404</p>
        <h1 className="font-display text-[2rem] leading-tight">Такой страницы нет</h1>
        <p className="text-[1rem] text-text-muted">
          Ссылка устарела или в адресе опечатка. Клуб мог поменять адрес страницы — найдите его поиском.
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[0.9375rem]">
          <Link href="/" className="text-text-accent underline underline-offset-2">
            Найти клуб
          </Link>
          <Link href="/my-bookings" className="text-text-accent underline underline-offset-2">
            Мои записи
          </Link>
          <Link href="/help" className="text-text-accent underline underline-offset-2">
            Помощь
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
