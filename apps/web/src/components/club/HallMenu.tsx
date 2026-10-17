'use client';

import type { PublicHall } from '@yenisey/types';
import { cn } from '@/lib/cn';
import { streetOf } from '@/lib/hallAddress';
import { useDisclosure } from '@/lib/useDisclosure';

/**
 * Фильтр по залам (решения владельца от 17.10.2026): один зал, несколько или
 * все — в «Предстоящих» и во вкладках «Мероприятия, тренеры и абонементы», у
 * каждого блока свой. Тем же выпадающим списком, что «Тренировки ▾»: отдельный
 * выбор зала над расписанием снят. Под названием зала — город и улица. Отметить все залы по одному — то же, что
 * «Все залы»: фильтр тогда снимается, и запрос уходит без него.
 */
export function HallMenu({
  halls,
  value,
  onChange,
}: {
  halls: readonly PublicHall[];
  value: string[] | null;
  onChange: (hallIds: string[] | null) => void;
}) {
  const menu = useDisclosure();
  const chosen = value ? halls.filter((hall) => value.includes(hall.id)) : [];
  const active = chosen.length > 0;

  const toggle = (hallId: string): void => {
    const next = value?.includes(hallId) ? value.filter((id) => id !== hallId) : [...(value ?? []), hallId];
    onChange(next.length === 0 || next.length === halls.length ? null : next);
  };

  const label =
    chosen.length === 0 ? 'Все залы' : chosen.length === 1 ? chosen[0]!.name : `Залы: ${chosen.length} из ${halls.length}`;

  return (
    <div ref={menu.root} className="relative sm:ml-auto">
      <button
        type="button"
        {...menu.buttonProps}
        aria-haspopup="true"
        onClick={menu.toggle}
        className={cn(
          'flex max-w-[16rem] items-center gap-1.5 rounded-control border px-3.5 py-1.5 text-[0.875rem] whitespace-nowrap transition-colors',
          active
            ? 'border-border-accent bg-surface-accent-soft text-text-accent'
            : 'border-border text-text-muted hover:bg-surface-sunken',
        )}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 14.5s4.5-4.2 4.5-7.7a4.5 4.5 0 1 0-9 0c0 3.5 4.5 7.7 4.5 7.7Z" />
          <circle cx="8" cy="6.8" r="1.6" />
        </svg>
        <span className="truncate">{label}</span>
        <svg aria-hidden="true" viewBox="0 0 12 12" className={cn('h-3 w-3 shrink-0 transition-transform', menu.open && 'rotate-180')}>
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {menu.open && (
        <div
          id={menu.panelId}
          role="group"
          aria-label="Залы"
          className="absolute top-full left-0 z-20 mt-1.5 max-h-80 w-max max-w-[min(20rem,calc(100vw-2.5rem))] min-w-[13rem] overflow-y-auto rounded-card border border-border bg-surface-raised p-1 shadow-lg sm:right-0 sm:left-auto"
        >
          <button
            type="button"
            onClick={() => {
              onChange(null);
              menu.close();
            }}
            className={cn(
              'flex w-full items-center rounded-control px-3 py-2 text-left text-[0.875rem] font-medium transition-colors',
              !active ? 'bg-surface-accent-soft text-text-accent' : 'text-text hover:bg-surface-sunken',
            )}
          >
            Все залы
          </button>
          {halls.map((hall) => {
            const checked = value?.includes(hall.id) ?? false;

            return (
              <label
                key={hall.id}
                className="flex cursor-pointer items-start gap-2.5 rounded-control px-3 py-2 text-[0.875rem] text-text transition-colors hover:bg-surface-sunken"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(hall.id)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                />
                {/* Под названием — город и адрес строками (просьба владельца
                    от 17.10.2026): залы клуба узнают по улице, а не по имени. */}
                <span className="min-w-0">
                  <span className="block">{hall.name}</span>
                  {hall.city && <span className="block text-[0.75rem] leading-snug text-text-subtle">{hall.city}</span>}
                  <span className="block text-[0.75rem] leading-snug text-text-subtle">
                    {streetOf(hall) ?? 'адрес не указан'}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
