import type { BookingDay, BookingDayTable, BusyInterval } from '@yenisey/types';

/**
 * Сетка выбора времени в форме брони.
 *
 * Шаг сетки здесь — минимальный шаг брони зала, а не полчаса как в
 * расписании: администратор закрашивает крупными мазками, а клиент выбирает
 * ровно то время, которое зал разрешает занять. Показывать ему получасовые
 * клетки в зале с шагом 15 минут значило бы прятать половину доступного
 * времени.
 *
 * Та же арифметика повторена на сервере (`booking/availability.ts`), и
 * последнее слово за ним: здесь она нужна, чтобы недоступное время было видно
 * до нажатия кнопки, а не после отказа.
 */

/** Клетка сетки: начало отрезка и можно ли его занять. */
export interface Slot {
  startMinute: number;
  /** Время свободно и ещё не прошло. */
  available: boolean;
}

/** Пересекаются ли два полуоткрытых промежутка. Стык пересечением не считается. */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Занят ли отрезок хотя бы одним промежутком. */
export function isBusy(
  busy: readonly BusyInterval[],
  startMinute: number,
  endMinute: number,
): boolean {
  return busy.some((slot) => overlaps(startMinute, endMinute, slot.startMinute, slot.endMinute));
}

/**
 * Начала клеток сетки — одни и те же для всех столов зала.
 *
 * Последняя клетка не выходит за полночь: отрезок, который в неё не
 * помещается целиком, занять всё равно нельзя.
 */
export function gridMinutes(day: BookingDay): number[] {
  const minutes: number[] = [];

  for (
    let minute = day.openMinute;
    minute + day.stepMinutes <= day.closeMinute;
    minute += day.stepMinutes
  ) {
    minutes.push(minute);
  }

  return minutes;
}

/** Свободна ли одна клетка конкретного стола. */
export function isAvailable(
  day: BookingDay,
  table: BookingDayTable,
  startMinute: number,
): boolean {
  return (
    startMinute >= day.earliestMinute &&
    !isBusy(table.busy, startMinute, startMinute + day.stepMinutes)
  );
}

/** Клетки одного стола на дату. */
export function slotsOf(day: BookingDay, table: BookingDayTable): Slot[] {
  return gridMinutes(day).map((startMinute) => ({
    startMinute,
    available: isAvailable(day, table, startMinute),
  }));
}

/**
 * Можно ли занять отрезок целиком.
 *
 * Проверяется весь отрезок разом, а не поклеточно: бронь с 19:00 до 20:30 не
 * должна проходить только потому, что свободны крайние клетки, а середина
 * занята.
 */
export function canBook(
  day: BookingDay,
  table: BookingDayTable,
  startMinute: number,
  durationMinutes: number,
): boolean {
  const endMinute = startMinute + durationMinutes;

  return (
    startMinute >= day.earliestMinute &&
    startMinute >= day.openMinute &&
    endMinute <= day.closeMinute &&
    !isBusy(table.busy, startMinute, endMinute)
  );
}

/**
 * Длительности, доступные от выбранного начала.
 *
 * Список обрывается на первом же занятом отрезке: предлагать два часа, когда
 * через полчаса стол уходит под тренировку, — значит показать клиенту вариант,
 * который сервер тут же отвергнет.
 */
export function durationsFrom(
  day: BookingDay,
  table: BookingDayTable,
  startMinute: number,
): number[] {
  const durations: number[] = [];

  for (
    let duration = day.stepMinutes;
    startMinute + duration <= day.closeMinute;
    duration += day.stepMinutes
  ) {
    if (!canBook(day, table, startMinute, duration)) {
      break;
    }

    durations.push(duration);
  }

  return durations;
}

/** Минуты от полуночи в «15:00» — для подписей в сетке. */
export function formatMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** «90 минут» человеческим языком: «1 ч 30 мин». */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) {
    return `${rest} мин`;
  }

  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

/**
 * Календарные даты, на которые открыта бронь: от сегодня и на горизонт вперёд.
 *
 * Считается от даты по времени клуба, а не браузера: клиент из другого пояса
 * иначе увидел бы на день больше или меньше, чем разрешает сервер.
 */
export function bookableDates(today: string, horizonDays: number): string[] {
  const start = Date.parse(`${today}T00:00:00Z`);

  return Array.from({ length: horizonDays + 1 }, (_, offset) =>
    new Date(start + offset * 86_400_000).toISOString().slice(0, 10),
  );
}

/** Дата по времени клуба, а не браузера: «сегодня» у зала своё. */
export function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** «2026-08-27» → «27 августа, четверг» — для выбора даты. */
export function formatDate(date: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    weekday: 'long',
  }).format(new Date(`${date}T00:00:00Z`));
}
