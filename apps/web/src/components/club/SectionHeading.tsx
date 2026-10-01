import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Заголовок блока страницы клуба — один на все блоки (решение владельца от
 * 30.09.2026): название и под ним короткое описание — что в блоке есть и что
 * здесь можно настроить. Заголовок — шрифтом обложки (вариант Д от
 * 30.09.2026), как развороты журнала. Раньше у каждого блока был свой `<h2>` своего
 * размера, а у вкладок зала заголовка не было вовсе.
 */
export function SectionHeading({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Справа от заголовка: счётчик, переключатель. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2', className)}>
      <div className="min-w-0 max-w-3xl">
        <h2 className="font-display text-[1.375rem] leading-tight sm:text-[1.5rem]">{title}</h2>
        {description && <p className="mt-1 text-[0.9375rem] text-text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
