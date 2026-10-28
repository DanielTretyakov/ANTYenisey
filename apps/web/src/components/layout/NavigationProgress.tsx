'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/** Дольше не крутим: сломанный переход не должен держать полосу вечно. */
const GIVE_UP_MS = 20_000;

/**
 * Полоса «загружаем страницу» вверху экрана — от нажатия на ссылку сайта до
 * смены адреса.
 *
 * По прогону «первых пользователей» 28.10.2026: после нажатия на карточку
 * клуба или «Мой календарь» экран 5–14 секунд не менялся, и человек решал,
 * что сайт завис, и нажимал снова. Ловим нажатия по ссылкам на другую
 * страницу этого же сайта; `Link` от Next сам гасит переход браузера, поэтому
 * `defaultPrevented` здесь не признак.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(false);
  }, [pathname]);

  useEffect(() => {
    function onClick(event: MouseEvent): void {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (!(link instanceof HTMLAnchorElement)) return;
      if ((link.target && link.target !== '_self') || link.hasAttribute('download')) return;

      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;

      setActive(true);
    }

    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setActive(false), GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [active]);

  if (!active) return null;

  return (
    <div
      role="progressbar"
      aria-label="Загружаем страницу"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] overflow-hidden bg-accent/20 print:hidden"
    >
      <span className="nav-progress block h-full w-2/5 bg-accent" />
    </div>
  );
}
