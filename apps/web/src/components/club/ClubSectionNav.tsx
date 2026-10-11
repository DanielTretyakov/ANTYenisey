'use client';

import { useCallback, useEffect, useState } from 'react';
import { SECTION_ACTIVE_OFFSET_CLUB } from '@/components/layout/metrics';
import { useClubPostsUnread } from '@/lib/clubPostsUnread';

/** Пункт меню: якорь блока и, для вкладок, — что прокручивать. */
export interface NavItem {
  id: string;
  label: string;
  /** Вкладка блока «Мероприятия · Тренеры · Абонементы»: блок другой, якорь — вкладки. */
  scrollTo?: string;
}

/** Якорь блока «О клубе» — описание, ценности, контакты. */
export const ABOUT_ANCHOR = 'pro-klub';

/** Разделы страницы для меню: подписи (с числом новых новостей), текущий и переход. */
export interface SectionNavState {
  items: { id: string; label: string }[];
  /** Пункт под меню сейчас; пусто — выше первого блока. */
  currentId: string | null;
  go: (id: string) => void;
}

/**
 * Разделы страницы клуба — подсветка по прокрутке и переход к блоку
 * (меню разделов — решение владельца от 30.09.2026, вариант Д). Пункты —
 * якоря тех же блоков (`#novosti`, `#reiting`, вкладки `#meropriyatiya`…),
 * поэтому старые ссылки работают как прежде; вкладки открываются сменой
 * якоря — `ClubTabs` сам слушает `hashchange`.
 *
 * Меню живёт в строке клуба (`ClubBar`, решение от 11.10.2026): на
 * компьютере — разделами в самой строке, на телефоне — группой её списка.
 * Отдельная липкая плашка под строкой снята — две полосы склеивались.
 */
export function useSectionNav(slug: string, items: NavItem[]): SectionNavState {
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

        if (top !== undefined && top < SECTION_ACTIVE_OFFSET_CLUB && top > currentTop + 1) {
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

  const go = useCallback(
    (id: string): void => {
      const item = items.find((candidate) => candidate.id === id);

      if (!item) return;

      if (item.scrollTo) {
        // Смена якоря открывает вкладку; тот же якорь второй раз события не
        // даёт, поэтому прокручиваем сами.
        if (window.location.hash !== `#${item.id}`) window.location.hash = item.id;
        document.getElementById(item.scrollTo)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      window.history.replaceState(null, '', `#${item.id}`);
      document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [items],
  );

  const current = items.find(
    (item) => active !== null && active === (item.scrollTo ?? item.id) && (!item.scrollTo || isTab(item.id)),
  );

  return {
    items: items.map((item) => ({
      id: item.id,
      label: item.id === 'novosti' && news > 0 ? `${item.label} · ${news} новых` : item.label,
    })),
    currentId: current?.id ?? null,
    go,
  };
}

/** Пункт-вкладка горит, только если открыта именно она. */
function isTab(id: string): boolean {
  if (typeof window === 'undefined') return false;

  const hash = window.location.hash.slice(1);

  return hash === id || (hash === '' && id === 'meropriyatiya');
}
