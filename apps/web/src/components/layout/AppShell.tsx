import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/Logo';
import { MainNav } from '@/components/layout/MainNav';
import { ThemeToggle } from '@/components/ThemeToggle';

/**
 * Каркас внутренних страниц: шапка с логотипом, разделами и содержимое.
 *
 * Разделы рисует MainNav и берёт их из роли вошедшего — страницам про это
 * знать не нужно. `actions` остаётся для того, что относится к конкретному
 * экрану, а не к приложению целиком.
 */
export function AppShell({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-sunken">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/85 backdrop-blur">
        <div className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:h-24 sm:px-8">
          <Link href="/" className="shrink-0">
            <Logo height={1.625} />
          </Link>
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
            {actions}
            <MainNav />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10 sm:px-8 sm:py-14">{children}</main>
    </div>
  );
}
