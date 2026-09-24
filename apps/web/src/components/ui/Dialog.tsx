'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Окно поверх страницы.
 *
 * Одно на весь продукт: до него три окна смены строили затемнение каждое
 * своё, а окну мероприятия нужно то же самое на стартовой, в клубе и в
 * сетке брони. Четыре копии разошлись бы первым же исправлением — скажем,
 * возвратом фокуса, которого не было ни в одной.
 *
 * Закрывается Escape, щелчком по затемнению и тем, что передаст содержимое.
 * Фокус при открытии уходит в окно, при закрытии возвращается туда, откуда
 * окно открыли: иначе после Escape клавиатура оказывается в начале страницы.
 */
export function Dialog({
  title,
  description,
  onClose,
  size = 'md',
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  size?: 'md' | 'lg';
  children: ReactNode;
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  // Последнее обещание закрыть — в ссылке: родитель часто передаёт новую
  // стрелку на каждой отрисовке, и эффект с ней в зависимостях снимал бы и
  // вешал обработчик заново, а фокус прыгал бы в окно при каждом вводе.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;

    document.body.style.overflow = 'hidden';
    box.current?.focus();

    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close.current();
    };

    window.addEventListener('keydown', escape);

    return () => {
      window.removeEventListener('keydown', escape);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, []);

  return (
    // Затемнение — краской из палитры, а не утилитой: в @theme inline
    // выведены только семантические роли, шкала --ink-* в классы не попадает.
    <div
      className="fixed inset-0 z-40 overflow-y-auto px-4 py-10"
      style={{ background: 'color-mix(in oklab, var(--ink-950) 45%, transparent)' }}
      onMouseDown={(event) => {
        // Только щелчок по самому затемнению: выделение текста в поле,
        // отпущенное за краем окна, закрывать его не должно.
        if (event.target === event.currentTarget) close.current();
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          // Контур фокуса у самого окна не нужен: фокус в него ставится
          // программно, чтобы Tab начинал с содержимого.
          'mx-auto w-full rounded-card border border-border bg-surface-raised shadow-lg',
          'focus:outline-none',
          size === 'lg' ? 'max-w-2xl' : 'max-w-lg',
        )}
      >
        <div className="flex items-start gap-3 border-b border-border px-6 py-5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[1.0625rem]">
              {title}
            </h2>
            {description && (
              <div className="mt-1 text-[0.875rem] text-text-muted">{description}</div>
            )}
          </div>
          <button
            type="button"
            onClick={() => close.current()}
            aria-label="Закрыть"
            className={cn(
              '-mt-1 -mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-control text-text-muted',
              'hover:bg-surface-sunken hover:text-text',
            )}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}
