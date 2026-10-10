'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';

/**
 * Несохранённые правки сетки не пропадают молча (решение от 05.10.2026).
 *
 * Раньше смена зала, режима или даты, ссылка в меню или перезагрузка страницы
 * просто выбрасывали всё закрашенное: сетка расписания — это минуты работы
 * мышью, и потерять их одним щелчком мимо было обычным делом.
 *
 * `guard(action)` выполняет действие сразу, если правок нет, и спрашивает —
 * если есть. Ссылки внутри сайта перехватываются сами, в фазе погружения:
 * до того, как `<Link>` успеет увести страницу. Закрытие и перезагрузку
 * вкладки браузер спрашивает своим окном — другого способа у страницы нет.
 */
export function useLeaveGuard(dirty: boolean): { guard: (action: () => void) => void; dialog: ReactNode } {
  const router = useRouter();
  const [pending, setPending] = useState<{ run: () => void } | null>(null);
  // Правки читаются из ссылки, а не из замыкания: `guard` уходит в дочерние
  // компоненты, и с `dirty` в зависимостях он менялся бы на каждый мазок.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const guard = useCallback((action: () => void): void => {
    if (dirtyRef.current) setPending({ run: action });
    else action();
  }, []);

  useEffect(() => {
    if (!dirty) return;

    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      // Без returnValue часть браузеров окна не покажет.
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', warn);

    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;

    const intercept = (event: MouseEvent): void => {
      // Новая вкладка и прочее с модификаторами страницу не покидает.
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;

      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.hasAttribute('download')) {
        return;
      }

      const url = new URL(link.href, window.location.href);
      const here = window.location;

      if (url.origin !== here.origin || (url.pathname === here.pathname && url.search === here.search)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setPending({ run: () => router.push(`${url.pathname}${url.search}${url.hash}`) });
    };

    document.addEventListener('click', intercept, true);

    return () => document.removeEventListener('click', intercept, true);
  }, [dirty, router]);

  const dialog = pending ? (
    <Dialog
      title="Правки не сохранены"
      description="Закрашенное с последнего сохранения пропадёт. Чтобы его оставить, вернитесь и нажмите «Сохранить»."
      onClose={() => setPending(null)}
    >
      <div className="flex flex-wrap justify-end gap-2 px-6 py-5">
        <Button type="button" variant="secondary" onClick={() => setPending(null)}>
          Вернуться к правкам
        </Button>
        <Button
          type="button"
          variant="danger"
          onClick={() => {
            const { run } = pending;

            setPending(null);
            run();
          }}
        >
          Уйти без сохранения
        </Button>
      </div>
    </Dialog>
  ) : null;

  return { guard, dialog };
}
