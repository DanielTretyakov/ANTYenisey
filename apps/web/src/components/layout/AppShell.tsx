import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';

/** Каркас внутренних страниц: шапка с логотипом и содержимое по центру. */
export function AppShell({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-sunken">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/85 backdrop-blur">
        <div className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between px-5 sm:h-24 sm:px-8">
          <Link href="/">
            <Logo height={1.625} />
          </Link>
          <div className="flex items-center gap-1.5 sm:gap-3">
            {actions}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10 sm:px-8 sm:py-14">{children}</main>
    </div>
  );
}
