import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BookingDay, BookingDayTable } from '@yenisey/types';
import {
  bookableDates,
  canBook,
  durationsFrom,
  formatDate,
  formatDuration,
  formatMinute,
  isBusy,
  slotsOf,
} from './bookingGrid.ts';

const day = (patch: Partial<BookingDay> = {}): BookingDay => ({
  hallId: 'hall',
  date: '2026-09-01',
  bookingStep: 'MIN_30',
  stepMinutes: 30,
  openMinute: 6 * 60,
  closeMinute: 24 * 60,
  earliestMinute: 6 * 60,
  hasRobotOption: true,
  tables: [],
  ...patch,
});

const table = (busy: BookingDayTable['busy'] = []): BookingDayTable => ({
  tableId: 'table',
  label: 'Стол 1',
  busy,
});

describe('isBusy', () => {
  it('видит пересечение', () => {
    assert.equal(isBusy([{ startMinute: 600, endMinute: 720 }], 660, 690), true);
  });

  it('стык пересечением не считается', () => {
    assert.equal(isBusy([{ startMinute: 600, endMinute: 660 }], 660, 720), false);
    assert.equal(isBusy([{ startMinute: 660, endMinute: 720 }], 600, 660), false);
  });
});

describe('slotsOf', () => {
  it('покрывает день от открытия до полуночи', () => {
    const slots = slotsOf(day(), table());

    assert.equal(slots.length, (24 * 60 - 6 * 60) / 30);
    assert.equal(slots[0]?.startMinute, 6 * 60);
    assert.equal(slots.at(-1)?.startMinute, 23 * 60 + 30);
  });

  it('не заводит клетку, которая не помещается до полуночи', () => {
    // Шаг в час: последняя клетка начинается в 23:00, а не в 23:30.
    const slots = slotsOf(day({ stepMinutes: 60 }), table());

    assert.equal(slots.at(-1)?.startMinute, 23 * 60);
  });

  it('помечает занятое недоступным', () => {
    const slots = slotsOf(day(), table([{ startMinute: 10 * 60, endMinute: 11 * 60 }]));
    const at = (minute: number) => slots.find((slot) => slot.startMinute === minute)?.available;

    assert.equal(at(9 * 60 + 30), true);
    assert.equal(at(10 * 60), false);
    assert.equal(at(10 * 60 + 30), false);
    assert.equal(at(11 * 60), true);
  });

  it('помечает прошедшее недоступным', () => {
    const slots = slotsOf(day({ earliestMinute: 12 * 60 }), table());
    const at = (minute: number) => slots.find((slot) => slot.startMinute === minute)?.available;

    assert.equal(at(11 * 60 + 30), false);
    assert.equal(at(12 * 60), true);
  });
});

describe('canBook', () => {
  it('пропускает свободный отрезок', () => {
    assert.equal(canBook(day(), table(), 19 * 60, 90), true);
  });

  it('ловит занятую середину, а не только края', () => {
    const busy = table([{ startMinute: 19 * 60 + 30, endMinute: 20 * 60 }]);

    // Крайние получасы свободны, но бронь целиком — нет.
    assert.equal(canBook(day(), busy, 19 * 60, 90), false);
  });

  it('не выпускает бронь за полночь', () => {
    assert.equal(canBook(day(), table(), 23 * 60 + 30, 60), false);
    assert.equal(canBook(day(), table(), 23 * 60, 60), true);
  });

  it('не отдаёт прошедшее время', () => {
    assert.equal(canBook(day({ earliestMinute: 20 * 60 }), table(), 19 * 60, 60), false);
  });
});

describe('durationsFrom', () => {
  it('идёт шагом зала', () => {
    const durations = durationsFrom(day(), table(), 22 * 60);

    assert.deepEqual(durations, [30, 60, 90, 120]);
  });

  it('обрывается на занятом времени, а не перескакивает его', () => {
    const busy = table([{ startMinute: 21 * 60, endMinute: 21 * 60 + 30 }]);

    // Стол уходит в 21:00 — от 20:00 доступен только час.
    assert.deepEqual(durationsFrom(day(), busy, 20 * 60), [30, 60]);
  });

  it('пуст, если занято сразу с начала', () => {
    const busy = table([{ startMinute: 20 * 60, endMinute: 21 * 60 }]);

    assert.deepEqual(durationsFrom(day(), busy, 20 * 60), []);
  });
});

describe('bookableDates', () => {
  it('открывает сегодня и весь горизонт вперёд', () => {
    const dates = bookableDates('2026-08-27', 14);

    assert.equal(dates.length, 15);
    assert.equal(dates[0], '2026-08-27');
    assert.equal(dates.at(-1), '2026-09-10');
  });

  it('переходит через границу месяца', () => {
    assert.deepEqual(bookableDates('2026-08-30', 2), ['2026-08-30', '2026-08-31', '2026-09-01']);
  });
});

describe('подписи', () => {
  it('минуты от полуночи читаются часами', () => {
    assert.equal(formatMinute(6 * 60), '06:00');
    assert.equal(formatMinute(23 * 60 + 30), '23:30');
  });

  it('длительность читается по-русски', () => {
    assert.equal(formatDuration(30), '30 мин');
    assert.equal(formatDuration(60), '1 ч');
    assert.equal(formatDuration(90), '1 ч 30 мин');
  });

  it('дата не съезжает на сутки из-за пояса браузера', () => {
    // Дата разбирается в UTC: иначе у клиента восточнее Гринвича «1 сентября»
    // показалось бы тридцать первым августа.
    assert.match(formatDate('2026-09-01'), /1 сентября/);
  });
});
