import type { BookingStep, BusyInterval } from '@yenisey/types';

/**
 * Свободное время стола: сетка, занятость и проверка заявки клиента.
 *
 * Чистая арифметика, отделённая от базы намеренно. Это тот код, который
 * решает, отдать клиенту стол или нет, и ошибка в нём тихо посадит человека
 * прямо под групповой тренировкой — такое надо проверять тестами, а не
 * поднятым Postgres.
 *
 * Последнее слово всё равно за базой: пересечение броней запрещено
 * exclusion-констрейнтом, и два одновременных запроса на один стол разведёт
 * именно он. Здесь проверка стоит ради внятного ответа клиенту.
 *
 * Относительных импортов в модуле нет намеренно: тесты запускаются через
 * `node --test`, а он требует расширение `.ts` в импорте, которого сборка не
 * принимает (см. tsconfig.build.json). Всё, что нужно отсюда снаружи,
 * передаётся аргументами.
 */

/** Минимальный шаг брони зала в минутах. */
export const STEP_MINUTES: Record<BookingStep, number> = {
  MIN_10: 10,
  MIN_15: 15,
  MIN_20: 20,
  MIN_30: 30,
  HOUR_1: 60,
};

/**
 * Границы сетки бронирования: с 06:00 до полуночи.
 *
 * Те же, что у сетки расписания в профиле клуба (`closureGrid.ts` на вебе):
 * ночью зал закрыт, и предлагать клиенту стол в четыре утра незачем. Часов
 * работы отдельным полем у клуба пока нет — когда появятся, границы приедут
 * оттуда, а эти константы станут значением по умолчанию.
 */
export const OPEN_MINUTE = 6 * 60;
export const CLOSE_MINUTE = 24 * 60;

/**
 * Пересекаются ли два полуоткрытых промежутка. Стык пересечением не считается.
 *
 * Повторяет `overlaps` из `club/closures.ts`: импортировать его сюда нельзя
 * (см. шапку модуля), а семантика полуоткрытого промежутка должна совпадать —
 * ровно её же реализует exclusion-констрейнт в базе диапазоном `'[)'`.
 */
function intersects(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Склейка занятых промежутков в непересекающиеся.
 *
 * Занятость собирается из двух источников — расписания зала и уже заведённых
 * броней, — и они накладываются друг на друга штатно: администратор закрыл
 * время под тренировку поверх часа, который клиент занял раньше. Клиенту
 * показывается «занято» одним куском, а не двумя перекрывающимися.
 *
 * Смежные промежутки тоже склеиваются: 10:00–11:00 и 11:00–12:00 — это один
 * занятый интервал, и граница между ними показала бы щель, которой нет.
 */
export function mergeBusy(intervals: readonly BusyInterval[]): BusyInterval[] {
  const sorted = [...intervals].sort((a, b) => a.startMinute - b.startMinute);
  const merged: BusyInterval[] = [];

  for (const interval of sorted) {
    const last = merged.at(-1);

    if (last && interval.startMinute <= last.endMinute) {
      last.endMinute = Math.max(last.endMinute, interval.endMinute);
      continue;
    }

    merged.push({ ...interval });
  }

  return merged;
}

export interface BookingCheck {
  startMinute: number;
  durationMinutes: number;
  stepMinutes: number;
  /**
   * Минута, раньше которой бронировать поздно: «сейчас» на сегодняшней дате,
   * начало сетки на будущих.
   */
  earliestMinute: number;
  busy: readonly BusyInterval[];
}

/**
 * Почему бронь невозможна, или `null`, если возможна.
 *
 * Одна строка, а не список: клиент выбирает время в сетке, и одновременно
 * нарушить два правила ему негде — а получив пять замечаний разом, он не
 * поймёт, какое из них исправлять.
 */
export function bookingViolation(check: BookingCheck): string | null {
  const { startMinute, durationMinutes, stepMinutes, earliestMinute, busy } = check;
  const endMinute = startMinute + durationMinutes;

  if (durationMinutes <= 0) {
    return 'Длительность брони должна быть больше нуля';
  }

  if (durationMinutes % stepMinutes !== 0) {
    return `Длительность брони кратна ${stepMinutes} минутам — это шаг этого зала`;
  }

  if (startMinute % stepMinutes !== 0) {
    return `Бронь начинается с шага в ${stepMinutes} минут`;
  }

  // Полночь как конец брони — это 1440, а не 0: бронь, переходящая за
  // полночь, попала бы в другие сутки, где действует уже другое расписание.
  if (startMinute < OPEN_MINUTE || endMinute > CLOSE_MINUTE) {
    return 'Забронировать можно с 06:00 до полуночи';
  }

  if (startMinute < earliestMinute) {
    return 'Это время уже прошло';
  }

  if (busy.some((slot) => intersects(startMinute, endMinute, slot.startMinute, slot.endMinute))) {
    return 'Стол в это время уже занят';
  }

  return null;
}

/**
 * Сколько процентов спишется при отмене прямо сейчас.
 *
 * Ступени политики клуба сортируются по порогу по убыванию, и берётся первая,
 * порог которой не превышает фактический запас времени до начала. Ступень с
 * порогом 0 обязательна — она ловит все поздние отмены и делает набор правил
 * полным; без неё отмена за минуту до начала не попала бы ни под одно правило.
 */
export function cancellationPercent(
  tiers: readonly { minMinutesBeforeStart: number; chargePercent: number }[],
  minutesBeforeStart: number,
): number {
  const applicable = [...tiers]
    .sort((a, b) => b.minMinutesBeforeStart - a.minMinutesBeforeStart)
    .find((tier) => minutesBeforeStart >= tier.minMinutesBeforeStart);

  // Клуб без единой ступени не описал политику вовсе. Списать в такой
  // ситуации нечего: брать деньги по правилу, которого нет, нельзя.
  return applicable?.chargePercent ?? 0;
}
