import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { busyAt, loadByHour, nextFrom, type BusySpan } from './hall-view.ts';

const span = (startMinute: number, endMinute: number, over: Partial<BusySpan> = {}): BusySpan => ({
  startMinute,
  endMinute,
  source: 'SCHEDULE',
  purpose: 'TRAINING',
  person: null,
  ...over,
});

describe('busyAt', () => {
  it('свободный стол не занят ничем', () => {
    assert.equal(busyAt([], 19 * 60), null);
    assert.equal(busyAt([span(20 * 60, 21 * 60)], 19 * 60), null);
  });

  /**
   * Промежуток полуоткрытый — та же семантика, что у exclusion-констрейнта в
   * базе. Разойтись им нельзя: экран показал бы занятым то, что база отдаёт
   * свободным.
   */
  it('конец промежутка стол уже не занимает', () => {
    const spans = [span(19 * 60, 20 * 60)];

    assert.notEqual(busyAt(spans, 19 * 60), null);
    assert.notEqual(busyAt(spans, 20 * 60 - 1), null);
    assert.equal(busyAt(spans, 20 * 60), null);
  });

  it('на наложении бронь важнее расписания', () => {
    const spans = [
      span(19 * 60, 21 * 60, { purpose: 'TRAINING' }),
      span(19 * 60, 20 * 60, { source: 'BOOKING', purpose: 'RENT', person: 'Соколов А.' }),
    ];

    const busy = busyAt(spans, 19 * 60 + 30);

    assert.equal(busy?.source, 'BOOKING');
    assert.equal(busy?.person, 'Соколов А.');
  });

  /**
   * Две брони встык — это занятый стол до конца второй. «До 20:00», за которым
   * сразу идёт занятость до 21:00, вводит в заблуждение сильнее, чем отсутствие
   * подсказки вовсе.
   */
  it('смежные промежутки продлевают занятость', () => {
    const spans = [span(19 * 60, 20 * 60), span(20 * 60, 21 * 60)];

    assert.equal(busyAt(spans, 19 * 60 + 10)?.untilMinute, 21 * 60);
  });

  it('разрыв обрывает занятость', () => {
    const spans = [span(19 * 60, 20 * 60), span(20 * 60 + 30, 21 * 60)];

    assert.equal(busyAt(spans, 19 * 60 + 10)?.untilMinute, 20 * 60);
  });

  it('перекрывающиеся промежутки считаются одной занятостью', () => {
    const spans = [span(19 * 60, 20 * 60), span(19 * 60 + 30, 21 * 60)];

    assert.equal(busyAt(spans, 19 * 60)?.untilMinute, 21 * 60);
  });
});

describe('nextFrom', () => {
  it('до конца дня больше ничего', () => {
    assert.equal(nextFrom([], 19 * 60), null);
    assert.equal(nextFrom([span(10 * 60, 11 * 60)], 19 * 60), null);
  });

  it('берётся ближайшее из будущих, а не первое в списке', () => {
    const spans = [span(22 * 60, 23 * 60), span(20 * 60, 21 * 60)];

    assert.equal(nextFrom(spans, 19 * 60), 20 * 60);
  });

  it('текущая занятость следующей не считается', () => {
    const spans = [span(19 * 60, 20 * 60)];

    assert.equal(nextFrom(spans, 19 * 60 + 30), null);
  });
});

describe('loadByHour', () => {
  it('пустой зал даёт нули на каждый час', () => {
    const load = loadByHour([[], []], 6 * 60, 24 * 60);

    assert.equal(load.length, 18);
    assert.equal(load[0]!.hour, 6);
    assert.equal(load.at(-1)!.hour, 23);
    assert.ok(load.every((hour) => hour.busyTables === 0));
  });

  /**
   * Получасовая бронь делает стол занятым в своём часу. Считать по «занят весь
   * час» было бы точнее арифметически и бесполезнее на практике: вечерний пик
   * из получасовых броней исчез бы с графика.
   */
  it('частичная занятость считается занятым часом', () => {
    const load = loadByHour([[span(19 * 60 + 30, 20 * 60)]], 19 * 60, 21 * 60);

    assert.deepEqual(load, [
      { hour: 19, busyTables: 1 },
      { hour: 20, busyTables: 0 },
    ]);
  });

  it('считаются столы, а не промежутки', () => {
    const load = loadByHour(
      [[span(19 * 60, 19 * 60 + 30), span(19 * 60 + 30, 20 * 60)], [span(19 * 60, 20 * 60)]],
      19 * 60,
      20 * 60,
    );

    assert.deepEqual(load, [{ hour: 19, busyTables: 2 }]);
  });

  it('стык часов не даёт лишней занятости', () => {
    // Бронь ровно до 20:00 занимает девятнадцатый час и не занимает двадцатый.
    const load = loadByHour([[span(19 * 60, 20 * 60)]], 19 * 60, 21 * 60);

    assert.deepEqual(load, [
      { hour: 19, busyTables: 1 },
      { hour: 20, busyTables: 0 },
    ]);
  });
});
