import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-text hover:bg-accent-hover active:bg-accent-active shadow-sm',
  secondary: 'bg-surface-raised text-text border border-border-strong hover:bg-surface-sunken',
  ghost: 'bg-transparent text-text-muted hover:bg-surface-sunken hover:text-text',
  danger: 'bg-danger-soft text-danger border border-danger-border hover:bg-danger-soft/70',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-[0.8125rem]',
  md: 'h-11 px-5 text-[0.9375rem]',
  lg: 'h-12 px-6 text-base',
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  /** Действие выполняется. Кнопка блокируется и сообщает об этом голосом. */
  pending?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
};

export function Button({
  variant = 'primary',
  size = 'md',
  pending = false,
  fullWidth = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      // aria-busy, а не только disabled: экранный диктор должен различать
      // «кнопка недоступна» и «нажатие принято, ждём ответ сервера».
      aria-busy={pending || undefined}
      disabled={disabled || pending}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-control',
        'font-medium whitespace-nowrap transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-55',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {pending && <Spinner />}
      {children}
    </button>
  );
}

/** Кружок ожидания. В цвет текста кнопки, чтобы работать во всех вариантах. */
function Spinner() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path
        d="M8 1.5 A6.5 6.5 0 0 1 14.5 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
