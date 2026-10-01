/**
 * Часы работы зала (решение владельца от 27.09.2026): у каждого зала свои,
 * правятся в настройках и вступают в силу в полночь, как всё о зале.
 *
 * Неделя — ровно семь дней с понедельника; день — «с — до» местного времени
 * зала или `null` — выходной. «24:00» — до полуночи. Ночных смен «22:00–02:00»
 * нет: сетка брони кончается в полночь, и зал так не работает.
 *
 * Общий модуль: сервер проверяет им правку, веб — подписывает часы.
 */

export interface WorkingDay {
  /** «08:00». */
  open: string;
  /** «23:00»; «24:00» — до полуночи. */
  close: string;
}

/** Семь дней с понедельника; `null` в дне — выходной. */
export type WorkingHours = (WorkingDay | null)[];

export const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;

const TIME = /^([01]\d|2[0-4]):([0-5]\d)$/;

/** «08:30» → 510; не время — null. «24:00» — 1440, «24:30» — не время. */
export function timeToMinutes(value: string): number | null {
  const match = TIME.exec(value);

  if (!match) return null;

  const minutes = Number(match[1]) * 60 + Number(match[2]);

  return minutes > 24 * 60 ? null : minutes;
}

/**
 * Разбор присланного или прочитанного из базы. Лишние поля отбрасываются,
 * время приводится к «ЧЧ:ММ». Ошибка — текстом для формы.
 */
export function parseWorkingHours(
  value: unknown,
): { ok: true; value: WorkingHours | null } | { ok: false; message: string } {
  if (value === null || value === undefined) {
    return { ok: true, value: null };
  }

  if (!Array.isArray(value) || value.length !== 7) {
    return { ok: false, message: 'Часы работы — по дню на каждый день недели, с понедельника' };
  }

  const days: WorkingHours = [];

  for (const [index, day] of value.entries()) {
    const name = WEEKDAY_SHORT[index];

    if (day === null) {
      days.push(null);
      continue;
    }

    const open = typeof day === 'object' && typeof day.open === 'string' ? timeToMinutes(day.open) : null;
    const close = typeof day === 'object' && typeof day.close === 'string' ? timeToMinutes(day.close) : null;

    if (open === null || close === null) {
      return { ok: false, message: `${name}: время — в виде «08:00»` };
    }

    if (open >= close) {
      return { ok: false, message: `${name}: зал открывается раньше, чем закрывается` };
    }

    days.push({ open: minutesToTime(open), close: minutesToTime(close) });
  }

  // Все дни выходные — это не часы работы, а их отсутствие.
  return { ok: true, value: days.every((day) => day === null) ? null : days };
}

/** То же, но молча: из базы негодное читается как «не указано». */
export function readWorkingHours(value: unknown): WorkingHours | null {
  const parsed = parseWorkingHours(value);

  return parsed.ok ? parsed.value : null;
}

/**
 * Часы строками, одинаковые дни подряд — одним диапазоном:
 * «Пн–Пт 08:00–23:00», «Сб–Вс 10:00–22:00», «Ср выходной».
 */
export function workingHoursLines(hours: WorkingHours | null): string[] {
  if (!hours) return [];

  const lines: string[] = [];
  let start = 0;

  for (let index = 1; index <= 7; index += 1) {
    if (index < 7 && sameDay(hours[index] ?? null, hours[start] ?? null)) continue;

    const days = index - 1 === start ? WEEKDAY_SHORT[start] : `${WEEKDAY_SHORT[start]}–${WEEKDAY_SHORT[index - 1]}`;
    const day = hours[start] ?? null;
    lines.push(`${days} ${day ? `${day.open}–${day.close}` : 'выходной'}`);
    start = index;
  }

  return lines.length === 1 && lines[0]!.startsWith('Пн–Вс ') ? [`Ежедневно ${lines[0]!.slice(6)}`] : lines;
}

/** День недели понедельником-нулём по календарной дате «2026-09-27». */
export function weekdayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

function sameDay(a: WorkingDay | null, b: WorkingDay | null): boolean {
  return a === b || (a !== null && b !== null && a.open === b.open && a.close === b.close);
}

function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Открыт ли зал сейчас (решение владельца от 30.09.2026: часы работы в
 * карточке зала — на виду). Время — местное время зала, а не смотрящего:
 * человек из Москвы смотрит на зал в Красноярске.
 *
 * `null` — часы не указаны; `opensAt: null` — на всей неделе ни дня работы.
 */
export type OpenState =
  | { open: true; closesAt: string }
  | { open: false; opensAt: { weekday: number; time: string; inDays: number } | null };

const WEEKDAY_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** День недели (понедельник — 0) и минута суток по поясу. */
export function localWeekMinute(now: Date, timezone: string): { weekday: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string): string => parts.find((item) => item.type === type)?.value ?? '';

  return {
    weekday: WEEKDAY_EN.indexOf(part('weekday')),
    minute: Number(part('hour')) * 60 + Number(part('minute')),
  };
}

export function openState(hours: WorkingHours | null, now: Date, timezone: string): OpenState | null {
  if (!hours) return null;

  const { weekday, minute } = localWeekMinute(now, timezone);
  const today = hours[weekday] ?? null;

  if (today) {
    const open = timeToMinutes(today.open)!;
    const close = timeToMinutes(today.close)!;

    if (minute >= open && minute < close) {
      return { open: true, closesAt: today.close };
    }

    if (minute < open) {
      return { open: false, opensAt: { weekday, time: today.open, inDays: 0 } };
    }
  }

  for (let inDays = 1; inDays <= 7; inDays += 1) {
    const day = (weekday + inDays) % 7;
    const next = hours[day] ?? null;

    if (next) {
      return { open: false, opensAt: { weekday: day, time: next.open, inDays } };
    }
  }

  return { open: false, opensAt: null };
}

/** «Открыто · до 23:00», «Закрыто · откроется завтра в 08:00». */
export function openStateLabel(state: OpenState): string {
  if (state.open) {
    return state.closesAt === '24:00' ? 'Открыто до полуночи' : `Открыто до ${state.closesAt}`;
  }

  if (!state.opensAt) return 'Закрыто';

  const { inDays, weekday, time } = state.opensAt;
  const when = inDays === 0 ? '' : inDays === 1 ? 'завтра ' : `в ${WEEKDAY_SHORT[weekday]!.toLowerCase()} `;

  return `Закрыто · откроется ${when}в ${time}`;
}
