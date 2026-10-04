'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

/**
 * Раскрывающаяся панель: меню аккаунта, новости клубов, разделы кабинета.
 *
 * Одна логика на всех (аудит 03.10.2026: до того она была скопирована в трёх
 * местах): панель закрывается щелчком снаружи, клавишей Escape и переходом на
 * другую страницу — шапка общая и не перемонтируется, и без этого меню
 * оставалось бы открытым поверх новой страницы.
 */
export function useDisclosure<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const root = useRef<T>(null);
  const panelId = useId();
  const pathname = usePathname();

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

  return {
    open,
    setOpen,
    toggle: () => setOpen((value) => !value),
    close: () => setOpen(false),
    root,
    /** Для кнопки: связывает её с панелью для экранного диктора. */
    buttonProps: { 'aria-expanded': open, 'aria-controls': panelId },
    panelId,
  };
}
