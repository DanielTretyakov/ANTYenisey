import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BookingDay, BookingDayTable } from '@yenisey/types';
import {
  blockSpans,
  bookableDates,
  bookableMinutes,
  canBook,
  cellState,
  durationsFrom,
  formatDate,
  formatDuration,
  formatMinute,
  gridMinutes,
  isBusy,
  pickAfterClick,
  pickPart,
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

describe('cellState', () => {
  it('различает занятое и прошедшее', () => {
    const today = day({ earliestMinute: 12 * 60 });
    const busy = table([{ startMinute: 14 * 60, endMinute: 15 * 60 }]);

    assert.equal(cellState(today, busy, 11 * 60), 'past');
    assert.equal(cellState(today, busy, 13 * 60), 'free');
    assert.equal(cellState(today, busy, 14 * 60), 'busy');
  });

  it('прошедшее остаётся прошедшим, даже если оно было занято', () => {
    // Иначе в подписи для диктора утренняя бронь звучала бы как «занято» —
    // и человек решал бы, что стол занят до сих пор.
    const today = day({ earliestMinute: 12 * 60 });

    assert.equal(cellState(today, table([{ startMinute: 7 * 60, endMinute: 8 * 60 }]), 7 * 60), 'past');
  });
});

describe('bookableMinutes', () => {
  it('у будущей даты сетка целая', () => {
    assert.deepEqual(bookableMinutes(day()), gridMinutes(day()));
  });

  it('прошедшие клетки не рисуются', () => {
    const rows = bookableMinutes(day({ earliestMinute: 20 * 60 + 15 }));

    // 20:15 — не по шагу сетки, поэтому первая клетка, которую ещё можно
    // занять, начинается в 20:30.
    assert.equal(rows[0], 20 * 60 + 30);
    assert.equal(rows.at(-1), 23 * 60 + 30);
  });

  it('поздним вечером не остаётся ни одной', () => {
    assert.deepEqual(bookableMinutes(day({ earliestMinute: 23 * 60 + 45 })), []);
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

describe('pickAfterClick', () => {
  const free = table();
  const at = (startMinute: number, durationMinutes = 30) => ({ tableId: 'table', startMinute, durationMinutes });

  it('первый щелчок — начало в один шаг', () => {
    assert.deepEqual(pickAfterClick(day(), free, null, 1140), at(1140));
  });

  it('щелчок ниже — отрезок от первой до последней клетки', () => {
    assert.deepEqual(pickAfterClick(day(), free, at(1140), 1200), at(1140, 90));
  });

  it('по начальной — выбор снят', () => {
    assert.equal(pickAfterClick(day(), free, at(1140, 90), 1140), null);
  });

  it('по последней клетке — короче на неё; внутри — до неё включительно', () => {
    assert.deepEqual(pickAfterClick(day(), free, at(1140, 90), 1200), at(1140, 60));
    assert.deepEqual(pickAfterClick(day(), free, at(1140, 120), 1170), at(1140, 60));
  });

  it('выше начала или другой стол — новое начало', () => {
    assert.deepEqual(pickAfterClick(day(), free, at(1140, 60), 1080), at(1080));
    assert.deepEqual(
      pickAfterClick(day(), { ...free, tableId: 'other' }, at(1140, 60), 1200),
      { tableId: 'other', startMinute: 1200, durationMinutes: 30 },
    );
  });

  it('между щелчками занято — новое начало там, куда щёлкнули', () => {
    const busy = table([{ startMinute: 1170, endMinute: 1200 }]);

    assert.deepEqual(pickAfterClick(day(), busy, at(1140), 1230), at(1230));
  });
});

describe('pickPart', () => {
  const pick = { tableId: 'table', startMinute: 1140, durationMinutes: 90 };

  it('начало, внутри и вне', () => {
    assert.equal(pickPart(pick, 'table', 1140), 'start');
    assert.equal(pickPart(pick, 'table', 1200), 'inside');
    assert.equal(pickPart(pick, 'table', 1230), null);
    assert.equal(pickPart(pick, 'other', 1170), null);
    assert.equal(pickPart(null, 'table', 1140), null);
  });
});

describe('blockSpans', () => {
  const rows = [1080, 1110, 1140, 1170, 1200, 1230]; // 18:00–21:00, шаг 30
  type Block = {
    startMinute: number;
    endMinute: number;
    kind: string;
    title: string;
    subtitle: string | null;
    event: { kind: string; id: string } | null;
  };
  const training: Block = {
    startMinute: 1080,
    endMinute: 1200,
    kind: 'TRAINING',
    title: 'Детская',
    subtitle: null,
    event: { kind: 'TRAINING', id: 't1' },
  };
  const at = (blocks: Block[]) => ({ blocks });

  it('тренировка на четырёх столах на два часа — один прямоугольник', () => {
    const spans = blockSpans([at([training]), at([training]), at([training]), at([training])], rows, 30);

    assert.equal(spans.length, 1);
    assert.deepEqual(
      { first: spans[0]!.firstTable, last: spans[0]!.lastTable, start: spans[0]!.rowStart, end: spans[0]!.rowEnd },
      { first: 0, last: 3, start: 0, end: 4 },
    );
  });

  it('стол без мероприятия посередине разрывает блок', () => {
    const spans = blockSpans([at([training]), at([]), at([training])], rows, 30);

    assert.deepEqual(
      spans.map((span) => [span.firstTable, span.lastTable]),
      [
        [0, 0],
        [2, 2],
      ],
    );
  });

  it('разное время или другое мероприятие — разные блоки', () => {
    const later = { ...training, startMinute: 1110 };
    const other = { ...training, event: { kind: 'TRAINING', id: 't2' } };

    assert.equal(blockSpans([at([training]), at([later])], rows, 30).length, 2);
    assert.equal(blockSpans([at([training]), at([other])], rows, 30).length, 2);
  });

  it('аренды рядом не склеиваются', () => {
    const rent: Block = { startMinute: 1080, endMinute: 1140, kind: 'RENT', title: 'Стол арендован', subtitle: null, event: null };

    assert.equal(blockSpans([at([rent]), at([rent])], rows, 30).length, 2);
  });

  it('начавшееся до первой строки обрезается, невидимое пропадает', () => {
    const early = { ...training, startMinute: 1020 };
    const gone = { ...training, startMinute: 900, endMinute: 960 };

    assert.deepEqual(
      blockSpans([at([early, gone])], rows, 30).map((span) => [span.rowStart, span.rowEnd]),
      [[0, 4]],
    );
  });

  it('окна шаблона одного занятия встык и на соседних столах — один блок', () => {
    const window = (start: number, end: number): Block => ({ ...training, startMinute: start, endMinute: end, event: null });
    const spans = blockSpans(
      [at([window(1080, 1110), window(1110, 1200)]), at([window(1080, 1200)])],
      rows,
      30,
    );

    assert.equal(spans.length, 1);
    assert.deepEqual([spans[0]!.lastTable, spans[0]!.block.endMinute, spans[0]!.rowEnd], [1, 1200, 4]);
  });
});
