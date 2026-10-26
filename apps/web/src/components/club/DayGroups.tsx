'use client';

import type { ReactNode } from 'react';
import { dateIn, dayIn } from '@/lib/zonedTime';

export interface DayGroupOf<T> {
  key: string;
  weekday: string;
  date: string;
  items: T[];
}

/**
 * Соседние записи одного дня — в группу (решение владельца от 17.10.2026 для
 * «Вся неделя», с 26.10.2026 — и в «Моём календаре»). День — по часам зала,
 * как в строке: занятие в 01:00 по Красноярску стоит в своём дне. Порядок
 * сохраняется: группируются только стоящие рядом.
 */
export function groupByDay<T extends { startsAt: string; timezone: string }>(items: readonly T[]): DayGroupOf<T>[] {
  const groups: DayGroupOf<T>[] = [];

  for (const item of items) {
    const key = dayIn(item.startsAt, item.timezone);
    const last = groups[groups.length - 1];

    if (last && last.key === key) {
      last.items.push(item);
      continue;
    }

    groups.push({
      key,
      weekday: dateIn(item.startsAt, item.timezone, { weekday: 'long' }),
      date: dateIn(item.startsAt, item.timezone, { day: 'numeric', month: 'long' }),
      items: [item],
    });
  }

  return groups;
}

/**
 * День одной группой: дата один раз слева, по высоте посередине, у строк —
 * только время; дату от строк отделяет тонкая полоса. Строки — `<li>` с
 * обёрткой, у которой своя нижняя граница и отступ: здесь они уплотняются,
 * а у последней граница снимается — её даёт сама группа.
 */
export function DayGroup({ weekday, date, children }: { weekday: string; date: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 border-b border-border py-3 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-x-5">
      <div className="relative flex items-center pr-4">
        <span aria-hidden="true" className="absolute inset-y-1 right-0 w-[3px] rounded-full bg-accent/70" />
        <span className="block">
          <span className="block text-[0.75rem] tracking-[0.06em] text-text-subtle uppercase">{weekday}</span>
          <span className="block font-display text-[1rem] leading-tight text-text sm:text-[1.0625rem]">{date}</span>
        </span>
      </div>
      <ul className="[&>li:last-child>div]:border-b-0 [&>li>div]:py-3.5">{children}</ul>
    </li>
  );
}
