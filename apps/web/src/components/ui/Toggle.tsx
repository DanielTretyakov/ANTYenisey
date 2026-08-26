'use client';

import { useId, type InputHTMLAttributes } from 'react';

type ToggleProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: string;
  hint?: string;
};

/**
 * Переключатель «да/нет».
 *
 * Родной checkbox, только оформленный: он сам держит состояние для диктора и
 * реагирует на пробел. Подпись — часть `<label>`, поэтому попасть по ней можно
 * мимо самого квадратика, что заметно важнее на телефоне.
 */
export function Toggle({ label, hint, id, ...rest }: ToggleProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;

  return (
    <div className="mb-4">
      <label htmlFor={fieldId} className="flex cursor-pointer items-start gap-3">
        <input
          id={fieldId}
          type="checkbox"
          aria-describedby={hintId}
          className="mt-0.5 h-4.5 w-4.5 shrink-0 cursor-pointer rounded-sm border border-border-strong accent-accent"
          {...rest}
        />
        <span className="text-[0.9375rem] text-text">{label}</span>
      </label>

      {hint && (
        <p id={hintId} className="mt-1.5 ml-7.5 text-[0.8125rem] text-text-subtle">
          {hint}
        </p>
      )}
    </div>
  );
}
