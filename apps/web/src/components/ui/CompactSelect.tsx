'use client';

import { useRouter } from 'next/navigation';
import { useId } from 'react';
import { cn } from '@/lib/cn';
import { inputClassName } from './Field';

export interface CompactOption {
  value: string;
  label: string;
  /** Заголовок группы (`<optgroup>`): соседние пункты одной группы идут под ним. */
  group?: string;
}

/** Соседние пункты одной группы — вместе; без групп — один безымянный блок. */
function grouped(options: CompactOption[]): { group?: string; options: CompactOption[] }[] {
  const blocks: { group?: string; options: CompactOption[] }[] = [];

  for (const option of options) {
    const last = blocks.at(-1);

    if (last && last.group === option.group) last.options.push(option);
    else blocks.push({ group: option.group, options: [option] });
  }

  return blocks;
}

/**
 * Выпадающий список вместо ленты или ряда кнопок — на телефоне (решение
 * владельца от 03.10.2026: «где можно, отказаться от прокрутки в пользу
 * выпадающего списка»). Нативный `<select>`, как и `Select`: клавиатура, поиск
 * по первой букве и родное колесо выбора на телефоне.
 *
 * Подпись — словом перед списком («Раздел», «Зал»), а не только для диктора:
 * без неё список «Основной зал ▾» не говорит, что это выбор.
 *
 * Показывается обычно только на узком экране: `className="sm:hidden"` у
 * обёртки, а прежняя лента — `hidden sm:flex`.
 */
export function CompactSelect({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: CompactOption[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const id = useId();

  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <label htmlFor={id} className="shrink-0 text-[0.8125rem] font-medium text-text-muted">
        {label}
      </label>
      <div className="relative min-w-0 grow">
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(inputClassName, 'h-11 w-full appearance-none truncate py-0 pr-9')}
        >
          {grouped(options).map((block, index) =>
            block.group ? (
              <optgroup key={`${block.group}:${index}`} label={block.group}>
                {block.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ) : (
              block.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))
            ),
          )}
        </select>
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 h-3 w-3 -translate-y-1/2 text-text-subtle"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
        >
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </div>
    </div>
  );
}

/** То же для навигации: выбор пункта уводит на его страницу. */
export function NavSelect({
  label,
  current,
  options,
  className,
}: {
  label: string;
  /** Адрес текущего пункта; не совпал ни один — первый пункт «Выберите…» не нужен, берётся первый. */
  current: string;
  options: { href: string; label: string; group?: string }[];
  className?: string;
}) {
  const router = useRouter();

  return (
    <CompactSelect
      label={label}
      value={options.some((option) => option.href === current) ? current : (options[0]?.href ?? '')}
      options={options.map((option) => ({ value: option.href, label: option.label, group: option.group }))}
      onChange={(href) => router.push(href)}
      className={className}
    />
  );
}
