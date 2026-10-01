'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { useClubPostsUnread } from '@/lib/clubPostsUnread';
import { cn } from '@/lib/cn';
import { plural } from '@/lib/plural';
import { useSession } from '@/lib/useSession';

/**
 * «Новости клубов» в шапке (решение владельца от 30.09.2026): число
 * непрочитанного по моим клубам и список клубов, где оно есть, — каждый ведёт
 * к блоку новостей клуба.
 *
 * Кнопка стоит у вошедшего всегда, с числом или без: шапка не меняет
 * геометрию от того, что пришло с сервера (правило SiteHeader). Пока сессия
 * грузится — заглушка того же размера.
 */
export function ClubNewsButton() {
  const session = useSession();
  const unread = useClubPostsUnread();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();

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
    return <span className="h-11 w-11 shrink-0" aria-hidden="true" />;
  }

  if (session.status !== 'ready') {
    return null;
  }

  const total = unread?.total ?? 0;
  const label = total > 0 ? `Новости клубов: ${total} ${plural(total, 'новая', 'новые', 'новых')}` : 'Новости клубов';

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        title={label}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-surface-sunken hover:text-text"
      >
        <NewsIcon />
        {total > 0 && (
          <span className="absolute top-1.5 right-1 grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-accent px-1 text-[0.6875rem] leading-none font-semibold text-accent-text">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      <div
        id={panelId}
        className={cn(
          'absolute top-full right-0 z-30 mt-2 w-72 rounded-card border border-border bg-surface-raised p-2 shadow-lg',
          open ? 'block' : 'hidden',
        )}
      >
        <p className="px-3 pt-1.5 pb-2 text-[0.75rem] tracking-[0.06em] text-text-subtle uppercase">Новости моих клубов</p>

        {total === 0 ? (
          <p className="px-3 pb-2 text-[0.875rem] text-text-muted">Всё прочитано. Новое появится здесь.</p>
        ) : (
          <ul>
            {unread!.clubs.map((club) => (
              <li key={club.slug}>
                <Link
                  href={`/clubs/${club.slug}/news`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-control px-3 py-2 text-[0.875rem] text-text hover:bg-surface-sunken"
                >
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: club.accentColor ?? 'var(--accent)' }}
                  />
                  <span className="min-w-0 grow truncate">{club.name}</span>
                  <span className="shrink-0 text-text-muted">
                    {club.unread} {plural(club.unread, 'новая', 'новые', 'новых')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function NewsIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <path d="M4 4.5h9.5v11H5.5A1.5 1.5 0 0 1 4 14V4.5Z" strokeLinejoin="round" />
      <path d="M13.5 7.5H16V14a1.5 1.5 0 0 1-3 0" strokeLinejoin="round" />
      <path d="M6.5 7.5h4.5M6.5 10h4.5M6.5 12.5h3" strokeLinecap="round" />
    </svg>
  );
}
