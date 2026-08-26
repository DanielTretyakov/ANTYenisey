'use client';

import { useId } from 'react';
import { inputClassName } from '@/components/ui/Field';
import { cn } from '@/lib/cn';

/**
 * Поле суммы в рублях.
 *
 * Человек вводит рубли, API принимает копейки — перевод делает `lib/money.ts`
 * на отправке формы. Здесь только ввод: знак рубля нарисован рядом с полем, а
 * не лежит в значении, иначе его пришлось бы вычищать из каждой строки.
 */
export function MoneyField({
  label,
  hint,
  value,
  onChange,
  invalid = false,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  /** Введено не число — поле подсвечивается, но введённое не стирается. */
  invalid?: boolean;
}) {
  const fieldId = useId();
  const hintId = hint ? `${fieldId}-hint` : undefined;

  return (
    <div className="mb-4">
      <label htmlFor={fieldId} className="mb-1.5 block text-[0.8125rem] font-medium text-text-muted">
        {label}
      </label>

      <div className="flex items-stretch">
        <input
          id={fieldId}
          // Не type="number": он режет запятую на части раскладок и молча
          // отдаёт пустую строку вместо введённого. Разбор всё равно наш.
          type="text"
          inputMode="decimal"
          aria-describedby={hintId}
          aria-invalid={invalid || undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(inputClassName, 'rounded-r-none', invalid && 'border-danger-border')}
        />
        <span
          className="inline-flex items-center rounded-r-control border border-l-0 border-border bg-surface-sunken px-3.5 font-medium text-text-muted"
          aria-hidden="true"
        >
          ₽
        </span>
      </div>

      {hint && (
        <p id={hintId} className="mt-1.5 text-[0.8125rem] text-text-subtle">
          {hint}
        </p>
      )}
    </div>
  );
}
