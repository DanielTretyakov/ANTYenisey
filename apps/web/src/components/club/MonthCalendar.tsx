'use client';

import type { ClubEvent } from '@yenisey/types';
import { cn } from '@/lib/cn';
import { dayKey, monthGrid } from '@/lib/month';
import { tintFill, tintMark } from '@/lib/personColor';
import { KIND_PAINT } from './EventRow';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
/** Сколько плашек влезает в клетку, остальное — «+N». */
const CHIPS_PER_DAY = 3;

/**
 * Календарь месяца: общая картина — в какие дни что есть (решение владельца
 * от 25.09.2026). Клетка — выбор дня (список дня выводит родитель), плашка —
 * окно мероприятия. На телефоне плашки не помещаются, и вместо них точки
 * цвета вида.
 */
export function MonthCalendar({
  start,
  events,
  selected,
  onSelect,
  onOpen,
}: {
  /** Первое число показываемого месяца. */
  start: Date;
  /** Мероприятия месяца — уже отфильтрованные. */
  events: ClubEvent[];
  /** Выбранный день — ключ `dayKey`. */
  selected: string | null;
  onSelect: (key: string) => void;
  onOpen: (event: ClubEvent) => void;
}) {
  const byDay = new Map<string, ClubEvent[]>();

  for (const event of events) {
    const key = dayKey(new Date(event.startsAt));
    byDay.set(key, [...(byDay.get(key) ?? []), event]);
  }

  const today = dayKey(new Date());
  const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface-raised">
      <div className="grid grid-cols-7 border-b border-border bg-surface-sunken" aria-hidden="true">
        {WEEKDAYS.map((name) => (
          <span key={name} className="py-2 text-center text-[0.75rem] tracking-wide text-text-subtle uppercase">
            {name}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7" role="grid" aria-label="Календарь месяца">
        {monthGrid(start).map(({ date, inMonth }) => {
          const key = dayKey(date);
          const list = inMonth ? (byDay.get(key) ?? []) : [];
          const past = key < today;
          const isSelected = key === selected;
          const label = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date);

          return (
            <div
              key={key}
              role="gridcell"
              aria-selected={isSelected}
              className={cn(
                'relative min-h-16 border-r border-b border-border p-1 sm:min-h-28 sm:p-1.5 [&:nth-child(7n)]:border-r-0',
                !inMonth && 'bg-surface-sunken/60',
                isSelected && 'bg-surface-accent-soft',
              )}
            >
              {/* Вся клетка — выбор дня; плашки лежат поверх и открывают окно. */}
              <button
                type="button"
                disabled={!inMonth}
                onClick={() => onSelect(key)}
                aria-label={`${label}: ${list.length > 0 ? `мероприятий — ${list.length}` : 'мероприятий нет'}`}
                className="absolute inset-0 rounded-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] disabled:cursor-default"
              />

              <span
                className={cn(
                  'relative inline-grid h-6 min-w-6 place-items-center rounded-full px-1 text-[0.8125rem]',
                  !inMonth ? 'text-text-subtle/60' : past ? 'text-text-subtle' : 'text-text',
                  key === today && 'bg-accent text-accent-text',
                )}
              >
                {date.getDate()}
              </span>

              {/* Телефон: точки цвета вида. */}
              {list.length > 0 && (
                <span className="pointer-events-none relative mt-1 flex flex-wrap gap-0.5 sm:hidden" aria-hidden="true">
                  {list.slice(0, 4).map((event) => (
                    <span
                      key={`${event.kind}-${event.id}`}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: tintMark(KIND_PAINT[event.kind]) }}
                    />
                  ))}
                </span>
              )}

              {/* Шире телефона: плашки «18:00 Детская». */}
              <span className="relative mt-1 hidden gap-0.5 sm:grid">
                {list.slice(0, CHIPS_PER_DAY).map((event) => (
                  <button
                    key={`${event.kind}-${event.id}`}
                    type="button"
                    onClick={() => onOpen(event)}
                    className={cn(
                      'truncate rounded-[0.3125rem] px-1.5 py-0.5 text-left text-[0.75rem] leading-tight text-text hover:brightness-95',
                      past && 'opacity-60',
                    )}
                    style={{
                      background: tintFill(KIND_PAINT[event.kind]),
                      boxShadow: `inset 2px 0 0 ${tintMark(KIND_PAINT[event.kind])}`,
                    }}
                    title={`${time.format(new Date(event.startsAt))} ${event.title}`}
                  >
                    <span className="font-display">{time.format(new Date(event.startsAt))}</span> {event.title}
                  </button>
                ))}
                {list.length > CHIPS_PER_DAY && (
                  <span className="pointer-events-none px-1.5 text-[0.75rem] text-text-muted">
                    ещё {list.length - CHIPS_PER_DAY}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
