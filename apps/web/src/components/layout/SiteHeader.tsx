'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode } from 'react';
import { PlatformLogo } from '@/components/brand/PlatformLogo';
import { AccountMenu } from '@/components/layout/AccountMenu';
import { ClubBar } from '@/components/layout/ClubNav';
import { ClubNewsButton } from '@/components/layout/ClubNewsButton';
import { HEADER_HEIGHT, HEADER_LOGO_HEIGHT } from '@/components/layout/metrics';
import { NavLink } from '@/components/layout/NavLink';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { loginHref } from '@/lib/next';
import { useSession } from '@/lib/useSession';

/**
 * Шапка платформы — одна на все страницы. Вариант А (решение владельца от
 * 03.10.2026, аудит): разделы платформы словами слева, справа — новости
 * клубов и меню аккаунта с именем; на страницах клуба — вторая тонкая строка
 * клуба (`ClubBar`).
 *
 * Правила, которые здесь нельзя нарушать:
 *
 * 1. **Высота основной строки фиксированная — HEADER_HEIGHT, одна на все
 *    разрешения** (см. metrics.ts). Строка клуба — отдельная полоса своей
 *    высоты, и липкие меню под шапкой клуба встают ниже на неё.
 * 2. **Состав шапки не меняет её геометрию.** Пока грузится сессия, справа
 *    стоят заглушки тех же размеров, что и будущие кнопки.
 */
export function SiteHeader({
  /** Клуб страницы — под шапкой появляется строка клуба с его разделами. */
  clubSlug,
  /** Действия самой страницы — то, что относится к экрану, а не к приложению. */
  actions,
  /** Прижать шапку к верху при прокрутке. Стартовой странице не нужно. */
  sticky = true,
  /**
   * Широкая полоса — под экраны, ширину которых диктуют данные, а не текст.
   * Такой у нас один: сетка расписания, где столов бывает двенадцать.
   */
  wide = false,
}: {
  clubSlug?: string;
  actions?: ReactNode;
  sticky?: boolean;
  wide?: boolean;
}) {
  const session = useSession();
  const pathname = usePathname();
  const signedIn = session.status === 'ready';
  const active = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));

  return (
    // Слой — над содержимым (сердечко обложки и шапка сетки — z-20/z-30
    // просвечивали сквозь меню аккаунта), но под окнами `Dialog` (z-40).
    <header className={cn('z-[35] border-b border-border bg-surface/85 backdrop-blur', sticky ? 'sticky top-0' : 'relative')}>
      <div
        className={cn(
          'mx-auto flex w-full items-center gap-2 px-5 sm:gap-3 sm:px-8',
          wide ? 'max-w-[112rem]' : 'max-w-6xl',
          HEADER_HEIGHT,
        )}
      >
        <Link href="/" className="shrink-0" aria-label="На стартовую страницу">
          <PlatformLogo height={HEADER_LOGO_HEIGHT} />
        </Link>

        {/* Разделы платформы словами — на компьютере. На телефоне их место
            занимают значок поиска и меню аккаунта. */}
        <nav aria-label="Разделы платформы" className="ml-4 hidden items-center gap-1 md:flex">
          <NavLink href="/" active={active('/')}>
            Найти клуб
          </NavLink>
          {signedIn && (
            <NavLink href="/my-bookings" active={active('/my-bookings')}>
              Мои записи
            </NavLink>
          )}
          <NavLink href="/help" active={active('/help')}>
            Помощь
          </NavLink>
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
          {actions}

          <Link
            href="/"
            aria-label="Найти клуб"
            title="Найти клуб"
            className="inline-flex h-11 w-11 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-surface-sunken hover:text-text md:hidden"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true">
              <circle cx="9" cy="9" r="5.5" />
              <path d="M13.2 13.2 17 17" />
            </svg>
          </Link>

          {session.status === 'loading' && (
            <>
              <span className="h-11 w-11 shrink-0" aria-hidden="true" />
              <span className="h-11 w-11 shrink-0 rounded-full bg-border/50 sm:w-36" aria-hidden="true" />
            </>
          )}

          {session.status === 'anonymous' && (
            <>
              <ThemeToggle />
              <Link href={loginHref()}>
                <Button size="sm">Войти</Button>
              </Link>
            </>
          )}

          {session.status === 'ready' && (
            <>
              <ClubNewsButton />
              <AccountMenu user={session.user} />
            </>
          )}
        </div>
      </div>

      {clubSlug && <ClubBar slug={clubSlug} />}
    </header>
  );
}
