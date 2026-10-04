import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Ссылка раздела в шапке и в строке клуба — одним видом: иначе две группы
 * ссылок в одной полосе выглядели бы разными элементами.
 */
export function NavLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex h-9 items-center rounded-control px-3 text-[0.875rem] whitespace-nowrap transition-colors',
        active ? 'bg-surface-accent-soft text-text-accent' : 'text-text-muted hover:bg-surface-sunken hover:text-text',
      )}
    >
      {children}
    </Link>
  );
}
