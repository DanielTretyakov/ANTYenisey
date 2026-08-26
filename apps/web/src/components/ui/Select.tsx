'use client';

import { useId, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { inputClassName } from './Field';

type Option = { value: string; label: string };

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
  options: Option[];
};

/**
 * Выбор из закрытого набора.
 *
 * Родной `<select>`, а не выпадающий список на div'ах: он умеет клавиатуру,
 * поиск по первой букве и нативный вид на телефоне — всё это пришлось бы
 * писать заново и хуже.
 */
export function Select({ label, hint, options, className, id, ...rest }: SelectProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;

  return (
    <div className="mb-4">
      <label htmlFor={fieldId} className="mb-1.5 block text-[0.8125rem] font-medium text-text-muted">
        {label}
      </label>

      <select
        id={fieldId}
        aria-describedby={hintId}
        className={cn(inputClassName, 'appearance-none pr-9', className)}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {hint && (
        <p id={hintId} className="mt-1.5 text-[0.8125rem] text-text-subtle">
          {hint}
        </p>
      )}
    </div>
  );
}
