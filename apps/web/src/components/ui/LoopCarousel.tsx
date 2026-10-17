'use client';

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/cn';

/**
 * Карусель по кругу — одним рядом, за последней карточкой справа снова первая
 * (решения владельца от 15.10.2026 для клубов на стартовой и от 17.10.2026 для
 * залов на странице клуба). На телефоне ряд листают пальцем, край следующей
 * карточки виден; стрелки — в строке заголовка (`CarouselArrow`), листают на
 * ширину видимого: сбоку поверх карточек они закрывали начало текста.
 *
 * Круг — тремя копиями ряда: смотрят всегда среднюю, а когда прокрутка
 * останавливается в крайней копии, лента незаметно перескакивает на то же
 * место средней (копии одинаковы, глаз скачка не видит). Крайние копии —
 * `inert`: по ним не ходит Tab и их не читает экранный диктор.
 */
export function LoopCarousel<T>({
  items,
  keyOf,
  render,
  track,
  label,
  itemClassName,
  layout = 'flex gap-4',
  loop = true,
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
  render: (item: T) => ReactNode;
  track: RefObject<HTMLUListElement | null>;
  /** Подпись ленты для экранного диктора. */
  label: string;
  /** Ширина карточки — `basis-*` по экранам (или классы ячейки сетки). */
  itemClassName: string;
  /**
   * Раскладка ленты. По умолчанию — flex; залам клуба нужна сетка колонками
   * (`grid grid-flow-col auto-cols-…`), чтобы строки карточек шли вровень
   * через subgrid.
   */
  layout?: string;
  /**
   * Ложно — ряд без круга, одной копией: карточек меньше, чем входит в ряд,
   * и повтор их по кругу показал бы одни и те же рядом. На телефоне такой
   * ряд всё равно листают пальцем.
   */
  loop?: boolean;
}) {
  return (
    <ul
      ref={track}
      aria-label={label}
      className={cn(
        '-mx-5 snap-x snap-mandatory scroll-px-5 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:mx-0 sm:scroll-px-0 sm:px-0 [&::-webkit-scrollbar]:hidden',
        layout,
      )}
    >
      {(loop ? [0, 1, 2] : [1]).flatMap((copy) =>
        items.map((item) => (
          <li
            key={`${copy}-${keyOf(item)}`}
            inert={copy !== 1}
            aria-hidden={copy !== 1 || undefined}
            className={cn('shrink-0 snap-start', itemClassName)}
          >
            {render(item)}
          </li>
        )),
      )}
    </ul>
  );
}

/**
 * Лента карусели: держит прокрутку в средней из трёх копий ряда и листает на
 * ширину видимого. `enabled` ложно — карусели нет (карточек мало, сетка), и
 * хук ничего не делает. Другой состав (`members`) — снова с первой карточки.
 */
export function useLoopCarousel(count: number, enabled: boolean, members: string) {
  const track = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const element = track.current;
    if (!element || !enabled) return;

    // Ширина одной копии ряда вместе с зазором до следующей.
    const copyWidth = (): number => {
      const items = element.children;
      return (items[count] as HTMLElement).offsetLeft - (items[0] as HTMLElement).offsetLeft;
    };

    // Остановились в крайней копии — на то же место средней.
    const recenter = (): void => {
      const width = copyWidth();
      if (element.scrollLeft < width - 1) element.scrollLeft += width;
      else if (element.scrollLeft >= 2 * width - 1) element.scrollLeft -= width;
    };

    const reset = (): void => {
      element.scrollLeft = copyWidth();
    };

    reset();

    // Конец прокрутки: `scrollend`, где он есть, иначе — пауза в событиях.
    let timer = 0;
    const onScroll = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(recenter, 150);
    };
    const native = 'onscrollend' in window;

    element.addEventListener(native ? 'scrollend' : 'scroll', native ? recenter : onScroll, { passive: true });
    window.addEventListener('resize', reset);

    return () => {
      window.clearTimeout(timer);
      element.removeEventListener(native ? 'scrollend' : 'scroll', native ? recenter : onScroll);
      window.removeEventListener('resize', reset);
    };
  }, [count, enabled, members]);

  function page(direction: 1 | -1): void {
    const element = track.current;
    if (!element) return;
    // Ширина видимого плюс зазор между карточками — следующий ряд встаёт ровно.
    element.scrollBy({ left: direction * (element.clientWidth + 16), behavior: 'smooth' });
  }

  return { track, page };
}

/** Стрелка карусели — в строке заголовка блока. */
export function CarouselArrow({ side, label, onClick }: { side: 'left' | 'right'; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface-raised text-text transition-colors hover:border-border-strong hover:bg-surface-sunken"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d={side === 'left' ? 'M10 3.5 5.5 8l4.5 4.5' : 'M6 3.5 10.5 8 6 12.5'} />
      </svg>
    </button>
  );
}
