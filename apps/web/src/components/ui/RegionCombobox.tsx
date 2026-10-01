'use client';

import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { inputClassName } from './Field';
import { SearchIcon } from './SearchIcon';

/** Регионы справочника — одни на все поля страницы, грузятся один раз. */
let regionsOnce: Promise<string[]> | null = null;

function loadRegions(): Promise<string[]> {
  regionsOnce ??= api.regions().catch(() => {
    regionsOnce = null;
    return [];
  });

  return regionsOnce;
}

/** «е» и «ё» — одна буква, как в поиске городов. */
function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/ё/g, 'е');
}

/**
 * Выбор региона с поиском (решение владельца от 30.09.2026): поиск клубов на
 * стартовой — по региону целиком. Устроен как `CityCombobox`, но список
 * короче — восемь десятков регионов справочника, — поэтому он приходит
 * целиком, а подсказки отбирает браузер: совпадение с началом любого слова.
 *
 * Свободного ввода нет: регион — строка справочника, иначе «Красноярский
 * край» и «Красноярский кр.» разошлись бы в поиске.
 */
export function RegionCombobox({
  label,
  hideLabel = false,
  value,
  onChange,
  emptyLabel,
  placeholder = 'Регион',
  className,
  inputClassName: inputClass,
  searchIcon = false,
}: {
  label: string;
  hideLabel?: boolean;
  value: string | null;
  onChange: (region: string | null) => void;
  /** Есть — первой подсказкой идёт «ничего не выбрано» с этой подписью. */
  emptyLabel?: string;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  searchIcon?: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;

  const [regions, setRegions] = useState<string[]>([]);
  const [text, setText] = useState(value ?? '');
  const [typed, setTyped] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    void loadRegions().then(setRegions);
  }, []);

  // Регион, выбранный снаружи (город поставил свой), — в поле.
  useEffect(() => {
    setText(value ?? '');
  }, [value]);

  const query = typed ? normalize(text) : '';
  const options = query
    ? regions.filter((region) =>
        normalize(region)
          .split(/[\s-]+/)
          .some((word) => word.startsWith(query)) || normalize(region).startsWith(query),
      )
    : regions;
  const items: (string | null)[] = emptyLabel ? [null, ...options] : options;

  function choose(region: string | null): void {
    setText(region ?? '');
    setOpen(false);
    setTyped(false);
    onChange(region);
  }

  function restore(): void {
    setText(value ?? '');
    setOpen(false);
    setTyped(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      setActive((index) => Math.min(index + 1, items.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      if (items.length > 0) choose(items[active] ?? null);
    } else if (event.key === 'Escape' && open) {
      event.stopPropagation();
      restore();
    }
  }

  return (
    <div className={cn('relative', className)}>
      <label
        htmlFor={id}
        className={cn('mb-1.5 block text-[0.8125rem] font-medium text-text-muted', hideLabel && 'sr-only')}
      >
        {label}
      </label>

      <div className="relative">
        {searchIcon && <SearchIcon />}
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && items.length > 0 ? `${id}-option-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={emptyLabel && !value ? emptyLabel : placeholder}
          value={text}
          onChange={(event) => {
            setTyped(true);
            setText(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={(event) => {
            event.target.select();
            setActive(0);
            setOpen(true);
          }}
          onBlur={restore}
          onKeyDown={onKeyDown}
          className={cn(inputClassName, searchIcon && 'pl-12', inputClass)}
        />
      </div>

      {open && items.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className={cn(
            'absolute top-full right-0 left-0 z-30 mt-1 max-h-72 overflow-y-auto',
            'rounded-control border border-border bg-surface-raised py-1 shadow-lg',
          )}
        >
          {items.map((region, index) => (
            <li
              key={region ?? 'empty'}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === active}
              // mousedown, а не click: blur закрыл бы список раньше выбора.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(region);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                'cursor-pointer px-3.5 py-2 text-[0.9375rem] text-text',
                index === active && 'bg-surface-sunken',
              )}
            >
              {region ?? <span className="text-text-muted">{emptyLabel}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
