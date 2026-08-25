import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'danger' | 'warning' | 'info';

const TONES: Record<Tone, string> = {
  danger: 'border-danger-border bg-danger-soft text-danger',
  warning: 'border-warning-border bg-warning-soft text-warning',
  info: 'border-border-accent bg-surface-accent-soft text-text-accent',
};

/**
 * Сообщение об ошибке или предупреждение.
 *
 * role="alert" только для ошибок: диктор перебивает чтение страницы, и делать
 * это ради справочной подсказки — значит приучить человека игнорировать
 * перебивания там, где они действительно важны.
 */
export function Alert({ tone = 'danger', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : undefined}
      className={cn(
        'mb-4 rounded-control border px-3.5 py-3 text-[0.875rem]',
        TONES[tone],
      )}
    >
      {children}
    </div>
  );
}
