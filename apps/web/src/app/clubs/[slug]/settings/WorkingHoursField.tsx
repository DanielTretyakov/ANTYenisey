'use client';

import { WEEKDAY_SHORT, type WorkingHours } from '@yenisey/types';
import { inputClassName } from '@/components/ui/Field';
import { Toggle } from '@/components/ui/Toggle';
import { cn } from '@/lib/cn';

/** День в форме: строки полей, пока человек печатает. */
export interface DayDraft {
  closed: boolean;
  open: string;
  close: string;
}

/** Часы в форме; `null` — часы не указаны. */
export type HoursDraft = DayDraft[] | null;

const DEFAULT_DAY: DayDraft = { closed: false, open: '08:00', close: '23:00' };

export function toHoursDraft(hours: WorkingHours | null): HoursDraft {
  return hours
    ? hours.map((day) => (day ? { closed: false, open: day.open, close: day.close } : { ...DEFAULT_DAY, closed: true }))
    : null;
}

/** Черновик в запрос. Проверяет сервер (`parseWorkingHours`) — и форма тоже, до отправки. */
export function fromHoursDraft(draft: HoursDraft): WorkingHours | null {
  return draft ? draft.map((day) => (day.closed ? null : { open: day.open.trim(), close: day.close.trim() })) : null;
}

/**
 * Часы работы зала (решение владельца от 27.09.2026): по дню недели, «с — до»
 * местного времени зала или выходной. «24:00» — до полуночи. Не указаны — на
 * странице клуба их нет вовсе.
 */
export function WorkingHoursField({ value, onChange }: { value: HoursDraft; onChange: (value: HoursDraft) => void }) {
  const setDay = (index: number, patch: Partial<DayDraft>): void =>
    onChange((value ?? []).map((day, at) => (at === index ? { ...day, ...patch } : day)));

  return (
    <fieldset className="mb-4">
      <Toggle
        label="Указать часы работы"
        hint="Видны посетителю на странице клуба. Время — местное, по поясу зала; «24:00» — до полуночи."
        checked={value !== null}
        onChange={(event) =>
          onChange(event.target.checked ? Array.from({ length: 7 }, () => ({ ...DEFAULT_DAY })) : null)
        }
      />

      {value && (
        <div className="mt-1 rounded-control border border-border p-3">
          <div className="grid gap-2">
            {value.map((day, index) => (
              <div key={WEEKDAY_SHORT[index]} className="flex flex-wrap items-center gap-2 text-[0.9375rem]">
                <span className="w-7 font-medium">{WEEKDAY_SHORT[index]}</span>
                <input
                  aria-label={`${WEEKDAY_SHORT[index]}: открытие`}
                  value={day.open}
                  disabled={day.closed}
                  onChange={(event) => setDay(index, { open: event.target.value })}
                  placeholder="08:00"
                  maxLength={5}
                  inputMode="numeric"
                  className={cn(inputClassName, '!w-20 py-1.5 text-center tabular-nums disabled:opacity-40')}
                />
                <span className="text-text-muted">—</span>
                <input
                  aria-label={`${WEEKDAY_SHORT[index]}: закрытие`}
                  value={day.close}
                  disabled={day.closed}
                  onChange={(event) => setDay(index, { close: event.target.value })}
                  placeholder="23:00"
                  maxLength={5}
                  inputMode="numeric"
                  className={cn(inputClassName, '!w-20 py-1.5 text-center tabular-nums disabled:opacity-40')}
                />
                <label className="ml-2 flex items-center gap-1.5 text-[0.875rem] text-text-muted">
                  <input
                    type="checkbox"
                    checked={day.closed}
                    onChange={(event) => setDay(index, { closed: event.target.checked })}
                  />
                  выходной
                </label>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onChange(value.map(() => ({ ...value[0]! })))}
            className="mt-3 text-[0.875rem] text-text-accent underline-offset-2 hover:underline"
          >
            Как в понедельник — на все дни
          </button>
        </div>
      )}
    </fieldset>
  );
}
