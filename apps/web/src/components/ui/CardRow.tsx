'use client';

import type { ReactNode } from 'react';
import { CarouselArrow, LoopCarousel, useLoopCarousel } from './LoopCarousel';

/**
 * Сколько карточек в ряду на компьютере; больше — карусель по кругу, а не ряд
 * (решение владельца от 17.10.2026: четыре). На телефоне — одна и край
 * следующей, на планшете — три.
 */
const PER_ROW = 4;
const ROW_BASIS = 'basis-[60%] sm:basis-[calc((100%-2rem)/3)] lg:basis-[calc((100%-3rem)/4)]';

/**
 * Обложка высокой карточки — градиент цвета клуба к чёрному, как полоса
 * карточки зала. Цвет — `--accent`: на странице клуба его ставит
 * `clubAccent`, у карточки чужого клуба — обёртка самой карточки.
 */
export const CARD_COVER =
  'radial-gradient(360px 260px at 100% 0%, color-mix(in oklab, var(--accent) 60%, transparent), transparent 75%), linear-gradient(160deg, color-mix(in oklab, var(--accent) 55%, var(--ink-950)), var(--ink-950))';

/**
 * Ряд высоких карточек (решения владельца от 17.10.2026): до четырёх — одним
 * рядом, больше — каруселью по кругу со стрелками справа над рядом; одна под
 * другой карточки не встают. На телефоне ряд листают пальцем. Вкладки
 * страницы клуба и «Ближайшее в моих клубах» на стартовой.
 */
export function CardRow<T>({
  items,
  keyOf,
  render,
  label,
  toolbar,
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
  render: (item: T) => ReactNode;
  label: string;
  /** Слева над рядом: переключатели вкладки. */
  toolbar?: ReactNode;
}) {
  const looped = items.length > PER_ROW;
  const carousel = useLoopCarousel(items.length, looped, items.map(keyOf).join(','));

  return (
    <>
      {(toolbar || looped) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {toolbar ?? <span />}
          {looped && (
            <span className="hidden gap-2 sm:flex">
              <CarouselArrow side="left" label="Назад" onClick={() => carousel.page(-1)} />
              <CarouselArrow side="right" label="Вперёд" onClick={() => carousel.page(1)} />
            </span>
          )}
        </div>
      )}
      <LoopCarousel
        items={items}
        keyOf={keyOf}
        render={render}
        track={carousel.track}
        label={label}
        loop={looped}
        itemClassName={ROW_BASIS}
      />
    </>
  );
}
