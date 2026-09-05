'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/Logo';
import { HEADER_HEIGHT, HEADER_LOGO_HEIGHT } from '@/components/layout/metrics';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { clearSession } from '@/lib/session';
import { useSession } from '@/lib/useSession';

/**
 * Шапка платформы — одна на все страницы.
 *
 * Раньше шапок было три: своя на стартовой странице, своя в AppShell и своя в
 * AuthLayout. Логотип в них был разной высоты, а высота полосы прыгала на
 * границе 640px, и переход между разделами читался как смена сайта.
 *
 * Отсюда два правила, которые здесь нельзя нарушать:
 *
 * 1. **Высота фиксированная — HEADER_HEIGHT, одна на все разрешения** (см.
 *    metrics.ts).
 * 2. **Состав шапки не меняет её геометрию.** Пока грузится сессия, правая
 *    группа рисует заглушки той же ширины, что и будущие ссылки. Прежний
 *    MainNav возвращал `null` и разделы впрыгивали после ответа сервера.
 */

/** Разделы уровня платформы. Клуба не имеют — аккаунт один на все клубы. */
const PLATFORM_SECTIONS: { href: string; label: string }[] = [
  { href: '/my-bookings', label: 'Мои записи' },
  { href: '/cabinet', label: 'Кабинет' },
];

export function SiteHeader({
  /** Разделы конкретного клуба. Их состав зависит от роли и знает о нём страница клуба. */
  clubNav,
  /** Действия самой страницы — то, что относится к экрану, а не к приложению. */
  actions,
  /** Прижать шапку к верху при прокрутке. Стартовой странице не нужно. */
  sticky = true,
}: {
  clubNav?: ReactNode;
  actions?: ReactNode;
  sticky?: boolean;
}) {
  return (
    <header
      className={cn(
        'z-20 border-b border-border bg-surface/85 backdrop-blur',
        sticky && 'sticky top-0',
      )}
    >
      <div
        className={cn(
          'mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8',
          HEADER_HEIGHT,
        )}
      >
        <Link href="/" className="shrink-0" aria-label="На стартовую страницу">
          <Logo height={HEADER_LOGO_HEIGHT} />
        </Link>

        <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
          {actions}
          {clubNav}
          <AccountNav />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

/**
 * Правая группа: разделы платформы и выход — либо кнопка входа.
 *
 * Сессию спрашивает сама, а не получает сверху: шапка стоит на каждой
 * странице, и протаскивать пользователя через все экраны означало бы менять
 * сигнатуру каждого из них ради одной строки.
 */
function AccountNav() {
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();

  if (session.status === 'loading') {
    return <NavSkeleton />;
  }

  if (session.status === 'anonymous') {
    return (
      <Link href="/login">
        <Button variant="secondary" size="sm">
          Войти
        </Button>
      </Link>
    );
  }

  async function handleLogout(): Promise<void> {
    // Токен гасится на сервере, а не только стирается локально: иначе
    // украденная копия осталась бы рабочей все 30 дней после «выхода».
    await api.logout().catch(() => undefined);

    clearSession();
    router.replace('/login');
  }

  return (
    <nav className="flex items-center gap-1 sm:gap-2" aria-label="Аккаунт">
      {PLATFORM_SECTIONS.map((section) => (
        <NavLink key={section.href} href={section.href} active={pathname === section.href}>
          {section.label}
        </NavLink>
      ))}

      <Button variant="ghost" size="sm" onClick={() => void handleLogout()}>
        Выйти
      </Button>
    </nav>
  );
}

/**
 * Ссылка раздела. Вынесена, потому что тот же вид нужен клубной навигации на
 * странице клуба — иначе две группы ссылок в одной полосе выглядели бы разными
 * элементами.
 */
export function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex h-9 items-center rounded-control px-3 text-[0.875rem] whitespace-nowrap transition-colors',
        active
          ? 'bg-surface-accent-soft text-text-accent'
          : 'text-text-muted hover:bg-surface-sunken hover:text-text',
      )}
    >
      {children}
    </Link>
  );
}

/**
 * Заглушка на время ответа сервера.
 *
 * Ширины подобраны под реальные надписи («Мои записи», «Кабинет», «Выйти»),
 * поэтому в момент ответа на их месте появляется текст, а не раздвигается
 * пустота. Тот же приём, что у скелета профиля в кабинете.
 */
function NavSkeleton() {
  return (
    <div className="flex items-center gap-1 sm:gap-2" aria-hidden="true">
      <span className="h-9 w-[6.5rem] rounded-control bg-border/50" />
      <span className="hidden h-9 w-[5.5rem] rounded-control bg-border/50 sm:block" />
      <span className="h-9 w-[4.5rem] rounded-control bg-border/50" />
    </div>
  );
}
