'use client';

import { useEffect, useState } from 'react';
import type { BookingDay } from '@yenisey/types';
import { Select } from '@/components/ui/Select';
import {
  bookableMinutes,
  formatDuration,
  formatMinute,
  freeTablesAt,
  nearestFreeStart,
  quickDurations,
  type GridPick,
} from '@/lib/bookingGrid';

/** С чего начинать, если человек ещё ничего не выбрал: вечер — главное время клуба. */
const PREFERRED_START = 19 * 60;

/**
 * Быстрая бронь «хочу в 19:00 на час» (решение владельца от 12.10.2026):
 * время и длительность списком — свободные столы кнопками. Нажатие ставит
 * тот же выбор, что щелчки по сетке, и дальше путь один: подтверждение с
 * ценой от сервера. Занято всё — ближайшее время, когда есть стол.
 */
export function QuickPick({ day, onPick }: { day: BookingDay; onPick: (pick: GridPick) => void }) {
  const starts = bookableMinutes(day);
  const durations = quickDurations(day);
  const [start, setStart] = useState<number | null>(null);
  const [duration, setDuration] = useState(durations[0] ?? day.stepMinutes);

  // Новая дата или зал — начало заново: прежнее могло не попасть в их сетку.
  useEffect(() => {
    setStart(null);
  }, [day.hallId, day.date]);

  if (starts.length === 0) {
    return null;
  }

  const chosen =
    start !== null && starts.includes(start)
      ? start
      : (starts.find((minute) => minute >= PREFERRED_START) ?? starts[starts.length - 1]!);
  const free = freeTablesAt(day, chosen, duration);
  const nearest = free.length === 0 ? nearestFreeStart(day, chosen, duration) : null;

  return (
    <div className="mb-5 rounded-control border border-border bg-surface-sunken/60 p-4">
      <p className="mb-3 text-[0.875rem] font-medium text-text">Быстро: когда и сколько</p>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Select
          label="Начало"
          value={String(chosen)}
          onChange={(event) => setStart(Number(event.target.value))}
          options={starts.map((minute) => ({ value: String(minute), label: formatMinute(minute) }))}
        />
        <Select
          label="Сколько"
          value={String(duration)}
          onChange={(event) => setDuration(Number(event.target.value))}
          options={durations.map((minutes) => ({ value: String(minutes), label: formatDuration(minutes) }))}
        />
      </div>

      {free.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[0.8125rem] text-text-muted">
            Свободно с {formatMinute(chosen)} до {formatMinute(chosen + duration)}:
          </span>
          {free.map((table) => (
            <button
              key={table.tableId}
              type="button"
              onClick={() => onPick({ tableId: table.tableId, startMinute: chosen, durationMinutes: duration })}
              className="rounded-full border border-border-accent bg-surface-accent-soft px-3 py-1 text-[0.8125rem] text-text-accent transition-colors hover:brightness-110"
            >
              {table.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[0.8125rem] text-text-muted">
          В это время все столы заняты.{' '}
          {nearest !== null ? (
            <button
              type="button"
              onClick={() => setStart(nearest)}
              className="text-text-accent underline underline-offset-2"
            >
              Ближайшее свободное — {formatMinute(nearest)}
            </button>
          ) : (
            'На эту длительность в этот день свободного стола нет — попробуйте другой день.'
          )}
        </p>
      )}
    </div>
  );
}
