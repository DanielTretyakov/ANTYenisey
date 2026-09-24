'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { PlatformLogo } from '@/components/brand/PlatformLogo';
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
  /**
   * Широкая полоса — под экраны, ширину которых диктуют данные, а не текст.
   *
   * Такой у нас один: сетка расписания, где столов бывает двенадцать. Шапка
   * обязана расширяться вместе с телом страницы — иначе логотип и разделы
   * повиснут посреди экрана, а содержимое уедет левее, и полоса перестанет
   * читаться как край страницы.
   */
  wide = false,
}: {
  clubNav?: ReactNode;
  actions?: ReactNode;
  sticky?: boolean;
  wide?: boolean;
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
          'mx-auto flex w-full items-center justify-between gap-4 px-5 sm:px-8',
          wide ? 'max-w-[112rem]' : 'max-w-6xl',
          HEADER_HEIGHT,
        )}
      >
        <Link href="/" className="shrink-0" aria-label="На стартовую страницу">
          <PlatformLogo height={HEADER_LOGO_HEIGHT} />
        </Link>

        <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
          {actions}
          <div className="hidden items-center gap-3 sm:flex">
            {clubNav}
            <AccountNav />
          </div>
          <MobileMenu clubNav={clubNav} />
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
        <NavLink key={section.href} href={section.href} active={pathname === section.href || pathname.startsWith(`${section.href}/`)}>
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
 * Разделы на узком экране — одной кнопкой меню.
 *
 * В строку на 400 px не помещаются даже три раздела аккаунта рядом с логотипом
 * и темой, а с разделом клуба («Забронировать стол») шапка вылезала вправо на
 * полторы сотни пикселей. Перенос на вторую строку нарушил бы неизменную
 * высоту шапки, поэтому разделы уходят в выпадающую панель.
 *
 * Гостю меню не нужно: у него одна кнопка «Войти», и она помещается.
 */
function MobileMenu({ clubNav }: { clubNav?: ReactNode }) {
  const session = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Переход по ссылке из меню закрывает его: шапка общая и не перемонтируется.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent): void {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (session.status === 'loading') {
    return <span className="h-11 w-11 sm:hidden" aria-hidden="true" />;
  }

  if (session.status === 'anonymous') {
    return (
      <div className="sm:hidden">
        <AccountNav />
      </div>
    );
  }

  return (
    <div ref={root} className="relative sm:hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Меню"
        title="Меню"
        className="inline-flex h-11 w-11 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-surface-sunken hover:text-text"
      >
        <svg
          viewBox="0 0 20 20"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          aria-hidden="true"
        >
          {open ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />}
        </svg>
      </button>

      {/* Панель скрывается, а не размонтируется: разделы внутри спрашивают
          сессию сами, и при каждом открытии заново мигали бы заглушками. */}
      <div
        id={panelId}
        // Те же группы ссылок, что и в строке на широком экране, — лишь
        // развёрнутые в столбец.
        className={cn(
          'absolute top-full right-0 z-30 mt-2 w-60 gap-1 rounded-card border border-border bg-surface-raised p-2 shadow-lg',
          '[&_a]:w-full [&_button]:w-full [&_button]:justify-start [&_button]:px-3 [&_button]:text-[0.875rem] [&_button]:font-normal',
          '[&_nav]:flex-col [&_nav]:items-stretch [&_nav]:gap-1',
          open ? 'grid' : 'hidden',
        )}
      >
        {clubNav && <div className="border-b border-border pb-1">{clubNav}</div>}
        <AccountNav />
      </div>
    </div>
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
