'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { AddressSuggestion } from '@yenisey/types';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useClubApi } from '@/lib/useClubApi';
import { inputClassName } from './Field';

/** Выбранный дом: что показать и код, который уйдёт на сервер. */
export interface ChosenAddress {
  value: string;
  fiasId: string;
}

/**
 * Адрес зала — только дом из справочника (решение владельца от 25.09.2026).
 *
 * Свободного ввода нет: набранный текст — лишь запрос подсказок, а
 * сохраняется код ФИАС выбранного дома, и строку адреса сервер берёт у
 * справочника сам. «Ул. Крутых Ключей, 777» подсказкой не станет, а без
 * подсказки форма зал не сохранит.
 *
 * Клавиатура — как у `CityCombobox`: стрелки, Enter, Escape возвращает
 * выбранное.
 */
export function AddressCombobox({
  label,
  hint,
  cityId,
  value,
  onChange,
  className,
}: {
  label: string;
  hint?: string;
  /** Город зала — подсказки только в нём. */
  cityId: string | null;
  value: ChosenAddress | null;
  onChange: (address: ChosenAddress | null) => void;
  className?: string;
}) {
  const club = useClubApi();
  const id = useId();
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;

  const [text, setText] = useState(value?.value ?? '');
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<AddressSuggestion[]>([]);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const typed = useRef(false);

  // Выбранное снаружи (другой зал во вкладках) — показать его.
  useEffect(() => {
    if (!typed.current) setText(value?.value ?? '');
  }, [value]);

  useEffect(() => {
    const query = text.trim();

    if (!open || !typed.current || query.length < 3) {
      setOptions([]);
      setStatus('idle');
      return;
    }

    let cancelled = false;
    setStatus('loading');

    // Задержка длиннее, чем у города: у DaData суточный лимит на весь
    // продукт, и запрос на каждую букву съел бы его за неделю.
    const timer = window.setTimeout(() => {
      club
        .addressSuggestions(query, cityId)
        .then((found) => {
          if (cancelled) return;
          setOptions(found);
          setActive(0);
          setStatus(found.length > 0 ? 'idle' : 'empty');
          setProblem(null);
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setOptions([]);
          setStatus('error');
          setProblem(cause instanceof ApiError ? cause.message : 'Справочник адресов недоступен');
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, text, cityId, club]);

  function choose(address: AddressSuggestion): void {
    typed.current = false;
    setText(address.value);
    setOpen(false);
    onChange({ value: address.value, fiasId: address.fiasId });
  }

  function restore(): void {
    typed.current = false;
    setText(value?.value ?? '');
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      const option = options[active];
      if (option) choose(option);
    } else if (event.key === 'Escape' && open) {
      event.stopPropagation();
      restore();
    }
  }

  const note =
    status === 'loading'
      ? 'Ищу в справочнике…'
      : status === 'empty'
        ? 'Такого дома в справочнике нет — проверьте улицу и номер дома.'
        : status === 'error'
          ? problem
          : open && typed.current && text.trim().length < 3
            ? 'Начните с улицы: «Партизана Железняка 25».'
            : null;

  return (
    <div className={cn('relative mb-4', className)}>
      <label htmlFor={id} className="mb-1.5 block text-[0.8125rem] font-medium text-text-muted">
        {label}
      </label>

      <input
        id={id}
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options.length > 0 ? `${id}-option-${active}` : undefined}
        aria-describedby={hintId}
        aria-invalid={value === null ? true : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="Улица и дом"
        value={text}
        onChange={(event) => {
          typed.current = true;
          setText(event.target.value);
          setOpen(true);
        }}
        onFocus={(event) => {
          event.target.select();
        }}
        onBlur={restore}
        onKeyDown={onKeyDown}
        className={inputClassName}
      />

      {open && options.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute top-[4.25rem] right-0 left-0 z-30 max-h-72 overflow-y-auto rounded-control border border-border bg-surface-raised py-1 shadow-lg"
        >
          {options.map((address, index) => (
            <li
              key={address.fiasId}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === active}
              // mousedown, а не click: click приходит после blur, а blur
              // закрывает список раньше, чем выбор успеет случиться.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(address);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                'cursor-pointer px-3.5 py-2 text-[0.9375rem] text-text',
                index === active && 'bg-surface-sunken',
              )}
            >
              {address.value}
            </li>
          ))}
        </ul>
      )}

      <p id={hintId} className={cn('mt-1.5 text-[0.8125rem]', status === 'error' ? 'text-danger' : 'text-text-subtle')}>
        {note ?? (value ? hint : 'Выберите дом из подсказок — без этого зал не сохранить.')}
      </p>
    </div>
  );
}
