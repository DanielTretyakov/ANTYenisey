'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { City } from '@yenisey/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { inputClassName } from './Field';

/**
 * Выбор города из справочника с поиском.
 *
 * Не `<select>`: в справочнике все города РФ, больше тысячи, и выбор из
 * такого списка — прокрутка, а не выбор. Свободного ввода по-прежнему нет —
 * сохраняется только город справочника, иначе «Красноярск» и «г. Красноярск»
 * снова стали бы двумя городами.
 *
 * Значение — идентификатор, как и было в формах: название комбобокс
 * подтягивает сам (`GET /cities/:id`), и форме не нужно держать город целиком.
 *
 * Клавиатура — по образцу ARIA combobox: стрелки ходят по подсказкам, Enter
 * выбирает, Escape возвращает прежнее название.
 */
export function CityCombobox({
  label,
  hideLabel = false,
  hint,
  value,
  onChange,
  emptyLabel,
  placeholder = 'Начните вводить город',
  className,
  inputClassName: inputClass,
}: {
  label: string;
  /** Подпись только для экранного диктора — когда поле стоит в строке поиска. */
  hideLabel?: boolean;
  hint?: string;
  value: string | null;
  onChange: (city: City | null) => void;
  /** Есть — первой подсказкой идёт «ничего не выбрано» с этой подписью. */
  emptyLabel?: string;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const hintId = hint ? `${id}-hint` : undefined;

  const [selected, setSelected] = useState<City | null>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<City[]>([]);
  const [active, setActive] = useState(0);
  const typed = useRef(false);

  // Название выбранного — по идентификатору. Сравнение с уже известным
  // городом — чтобы не ходить на сервер за тем, что только что выбрали сами.
  useEffect(() => {
    if (!value) {
      setSelected(null);
      setText('');
      return;
    }

    if (selected?.id === value) return;

    let cancelled = false;

    api
      .city(value)
      .then((city) => {
        if (cancelled) return;
        setSelected(city);
        setText(city.name);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [value, selected?.id]);

  // Подсказки — с задержкой: запрос на каждую букву сервер выдержит, но
  // список, дёргающийся под пальцами, читать нельзя.
  useEffect(() => {
    if (!open) return;

    const query = typed.current ? text : '';
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .cities(query, 8)
        .then((found) => {
          if (cancelled) return;
          setOptions(found);
          setActive(0);
        })
        .catch(() => {
          if (!cancelled) setOptions([]);
        });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, text]);

  const items: (City | null)[] = emptyLabel ? [null, ...options] : options;

  function choose(city: City | null): void {
    setSelected(city);
    setText(city?.name ?? '');
    setOpen(false);
    typed.current = false;
    onChange(city);
  }

  function restore(): void {
    setText(selected?.name ?? '');
    setOpen(false);
    typed.current = false;
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
      // Своё закрытие не должно закрывать и окно, в котором стоит поле.
      event.stopPropagation();
      restore();
    }
  }

  return (
    <div className={cn('relative', className)}>
      <label
        htmlFor={id}
        className={cn(
          'mb-1.5 block text-[0.8125rem] font-medium text-text-muted',
          hideLabel && 'sr-only',
        )}
      >
        {label}
      </label>

      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && items.length > 0 ? `${id}-option-${active}` : undefined}
        aria-describedby={hintId}
        autoComplete="off"
        spellCheck={false}
        placeholder={emptyLabel && !selected ? emptyLabel : placeholder}
        value={text}
        onChange={(event) => {
          typed.current = true;
          setText(event.target.value);
          setOpen(true);
        }}
        onFocus={(event) => {
          event.target.select();
          setOpen(true);
        }}
        onBlur={restore}
        onKeyDown={onKeyDown}
        className={cn(inputClassName, inputClass)}
      />

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
          {items.map((city, index) => (
            <li
              key={city?.id ?? 'empty'}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === active}
              // mousedown, а не click: click приходит после blur, а blur
              // закрывает список раньше, чем выбор успеет случиться.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(city);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                'cursor-pointer px-3.5 py-2 text-[0.9375rem]',
                index === active ? 'bg-surface-sunken text-text' : 'text-text',
              )}
            >
              {city ? (
                <>
                  <span className="block">{city.name}</span>
                  {city.region && (
                    <span className="block text-[0.8125rem] text-text-subtle">{city.region}</span>
                  )}
                </>
              ) : (
                <span className="text-text-muted">{emptyLabel}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {hint && (
        <p id={hintId} className="mt-1.5 text-[0.8125rem] text-text-subtle">
          {hint}
        </p>
      )}
    </div>
  );
}
