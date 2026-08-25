'use client';

import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Общие классы поля ввода. Вынесены отдельно, потому что их переиспользуют
 *  составные поля — например, телефон с несъёмным префиксом. */
export const inputClassName = cn(
  'block w-full rounded-control border border-border bg-surface-raised',
  'px-3.5 py-2.5 text-[0.9375rem] text-text placeholder:text-text-subtle',
  'transition-colors duration-150',
  'hover:border-border-strong',
  // Гашение системного контура здесь намеренно отсутствует: глобальное кольцо
  // фокуса из globals.css должно доходить и до полей. Утилиты лежат в слое
  // выше базового и молча перекрывали его — единственным признаком фокуса
  // оставалась смена цвета рамки на один пиксель, чего мало для клавиатуры.
  // (Названия утилит в комментариях не писать: Tailwind сканирует и их,
  // и генерирует мёртвые классы.)
  'focus:border-accent',
  'disabled:cursor-not-allowed disabled:opacity-55',
);

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  /** Поясняющая строка под полем: формат, ограничение, пример. */
  hint?: string;
  /** Готовый контрол вместо <input> — для составных полей. */
  children?: ReactNode;
};

export function Field({ label, hint, children, className, id, ...rest }: FieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;

  return (
    <div className="mb-4">
      <label
        htmlFor={children ? undefined : fieldId}
        className="mb-1.5 block text-[0.8125rem] font-medium text-text-muted"
      >
        {label}
      </label>

      {children ?? (
        <input id={fieldId} aria-describedby={hintId} className={cn(inputClassName, className)} {...rest} />
      )}

      {hint && (
        <p id={hintId} className="mt-1.5 text-[0.8125rem] text-text-subtle">
          {hint}
        </p>
      )}
    </div>
  );
}
