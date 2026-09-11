import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Вкладка-пилюля: переключатель внутри страницы.
 *
 * Один и тот же набор классов был продублирован инлайном в пяти местах —
 * режимы расписания, дни недели, залы в настройках, роли в составе клуба,
 * назначения в палитре. Копии уже начали расходиться: где-то `px-3`, где-то
 * `px-3.5`. Шестая копия появилась бы вместе с разделом «Расписание», и вместо
 * неё заведён этот примитив.
 *
 * Не путать с `NavLink` из шапки: тот ведёт на другой адрес и помечается
 * `aria-current`, а это переключатель состояния текущей страницы —
 * `aria-pressed` либо `role="tab"` с `aria-selected`.
 */
export function Tab({
  active,
  onClick,
  children,
  /**
   * Пометка справа от подписи: счётчик закрашенных окон, число людей в роли.
   * Приглушена намеренно — это подсказка, а не вторая подпись.
   */
  badge,
  /**
   * `true` — вкладка внутри `role="tablist"`, и состояние сообщается через
   * `aria-selected`. По умолчанию это одиночная кнопка-переключатель.
   */
  inTablist = false,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  badge?: ReactNode;
  inTablist?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      role={inTablist ? 'tab' : undefined}
      aria-selected={inTablist ? active : undefined}
      aria-pressed={inTablist ? undefined : active}
      onClick={onClick}
      className={cn(
        'rounded-control border px-3.5 py-1.5 text-[0.875rem] whitespace-nowrap transition-colors',
        active
          ? 'border-border-accent bg-surface-accent-soft text-text-accent'
          : 'border-border text-text-muted hover:bg-surface-sunken',
      )}
    >
      {children}
      {badge !== undefined && badge !== null && (
        <span className="ml-1.5 text-[0.75rem] opacity-70">{badge}</span>
      )}
    </button>
  );
}
