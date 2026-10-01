'use client';

import { useEffect, useState } from 'react';
import { useClubPostsUnread } from '@/lib/clubPostsUnread';
import { cn } from '@/lib/cn';

/** Пункт меню: якорь блока и, для вкладок, — что прокручивать. */
interface NavItem {
  id: string;
  label: string;
  /** Вкладка блока «Мероприятия · Тренеры · Абонементы»: блок другой, якорь — вкладки. */
  scrollTo?: string;
}

/** Якорь блока «О клубе» — описание, ценности, контакты. */
export const ABOUT_ANCHOR = 'pro-klub';

/**
 * Липкое меню разделов страницы клуба (решение владельца от 30.09.2026,
 * вариант Д): вместо долгой прокрутки наугад — переход к блоку. Пункты —
 * якоря тех же блоков, что и раньше (`#novosti`, `#reiting`, вкладки
 * `#meropriyatiya`…), поэтому старые ссылки работают как прежде.
 *
 * Вкладки открываются сменой якоря — `ClubTabs` сам слушает `hashchange`.
 */
export function ClubSectionNav({
  slug,
  items,
}: {
  slug: string;
  items: NavItem[];
}) {
  const unread = useClubPostsUnread();
  const news = unread?.clubs.find((club) => club.slug === slug)?.unread ?? 0;
  const [active, setActive] = useState<string | null>(null);

  // Подсветка — по блоку, который сейчас под меню.
  useEffect(() => {
    const ids = [...new Set(items.map((item) => item.scrollTo ?? item.id))];
    const onScroll = (): void => {
      let current: string | null = null;
      let currentTop = -Infinity;

      // Ниже всех из уже ушедших под меню; блоки в одном ряду (новости и
      // рейтинг) — побеждает стоящий раньше.
      for (const id of ids) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;

        if (top !== undefined && top < 180 && top > currentTop + 1) {
          current = id;
          currentTop = top;
        }
      }

      setActive(current);
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => window.removeEventListener('scroll', onScroll);
  }, [items]);

  function go(item: NavItem): void {
    if (item.scrollTo) {
      // Смена якоря открывает вкладку; тот же якорь второй раз события не
      // даёт, поэтому прокручиваем сами.
      if (window.location.hash !== `#${item.id}`) window.location.hash = item.id;
      document.getElementById(item.scrollTo)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    window.history.replaceState(null, '', `#${item.id}`);
    document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <nav
      aria-label="Разделы страницы клуба"
      className="sticky top-20 z-10 mb-10 -mx-1 overflow-x-auto rounded-card border border-border bg-surface-raised/90 p-1.5 backdrop-blur [scrollbar-width:none]"
    >
      <ul className="flex w-max gap-1">
        {items.map((item) => {
          const current = active !== null && active === (item.scrollTo ?? item.id) && (!item.scrollTo || isTab(item.id));

          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => go(item)}
                aria-current={current ? 'true' : undefined}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[0.875rem] whitespace-nowrap transition-colors',
                  current ? 'bg-accent text-accent-text' : 'text-text-muted hover:bg-surface-sunken hover:text-text',
                )}
              >
                {item.label}
                {item.id === 'novosti' && news > 0 && (
                  <span
                    className={cn(
                      'grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full px-1 text-[0.6875rem] font-semibold',
                      current ? 'bg-accent-text text-accent' : 'bg-accent text-accent-text',
                    )}
                  >
                    {news}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Пункт-вкладка горит, только если открыта именно она. */
function isTab(id: string): boolean {
  if (typeof window === 'undefined') return false;

  const hash = window.location.hash.slice(1);

  return hash === id || (hash === '' && id === 'meropriyatiya');
}
