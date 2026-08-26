import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClosureRule } from '@yenisey/types';
import {
  cellKey,
  cellsToRules,
  copyDay,
  countClosedSlots,
  rulesToCells,
  slotLabel,
  SLOTS_PER_DAY,
} from './closureGrid.ts';

const rule = (overrides: Partial<ClosureRule> = {}): ClosureRule => ({
  id: 'r1',
  tableId: 't1',
  weekday: 2,
  startMinute: 15 * 60,
  endMinute: 19 * 60,
  ...overrides,
});

describe('slotLabel', () => {
  it('показывает начало получасового слота', () => {
    assert.equal(slotLabel(0), '00:00');
    assert.equal(slotLabel(1), '00:30');
    assert.equal(slotLabel(30), '15:00');
    assert.equal(slotLabel(47), '23:30');
  });
});

describe('rulesToCells', () => {
  it('окно разворачивается в клетки по получасу', () => {
    const cells = rulesToCells([rule()]);

    // 15:00–19:00 — это восемь получасовых клеток.
    assert.equal(cells.size, 8);
    assert.equal(cells.has(cellKey(2, 't1', 30)), true); // 15:00
    assert.equal(cells.has(cellKey(2, 't1', 37)), true); // 18:30
  });

  it('клетка после конца окна не закрашивается', () => {
    // Окно кончается в 19:00, значит 19:00–19:30 уже свободно.
    assert.equal(rulesToCells([rule()]).has(cellKey(2, 't1', 38)), false);
  });

  it('окно не по сетке округляется наружу — закрытое время не теряется', () => {
    const cells = rulesToCells([rule({ startMinute: 15 * 60 + 10, endMinute: 15 * 60 + 50 })]);

    assert.equal(cells.has(cellKey(2, 't1', 30)), true); // 15:00–15:30
    assert.equal(cells.has(cellKey(2, 't1', 31)), true); // 15:30–16:00
    assert.equal(cells.size, 2);
  });

  it('окно до полуночи помещается в сутки целиком', () => {
    const cells = rulesToCells([rule({ startMinute: 23 * 60, endMinute: 1440 })]);

    assert.equal(cells.size, 2);
    assert.equal(cells.has(cellKey(2, 't1', SLOTS_PER_DAY - 1)), true);
  });
});

describe('cellsToRules', () => {
  it('соседние клетки склеиваются в одно окно', () => {
    const cells = rulesToCells([rule()]);
    const rules = cellsToRules(cells, ['t1']);

    assert.equal(rules.length, 1);
    assert.deepEqual(rules[0], {
      tableId: 't1',
      weekday: 2,
      startMinute: 900,
      endMinute: 1140,
    });
  });

  it('разрыв в середине даёт два окна, а не одно', () => {
    const cells = new Set([
      cellKey(2, 't1', 20),
      cellKey(2, 't1', 21),
      // 22-я клетка пропущена — стол открыт
      cellKey(2, 't1', 23),
    ]);

    const rules = cellsToRules(cells, ['t1']);

    assert.equal(rules.length, 2);
    assert.deepEqual(rules[0], { tableId: 't1', weekday: 2, startMinute: 600, endMinute: 660 });
    assert.deepEqual(rules[1], { tableId: 't1', weekday: 2, startMinute: 690, endMinute: 720 });
  });

  it('окно, упирающееся в полночь, закрывается на 1440, а не обрывается', () => {
    const cells = new Set([
      cellKey(2, 't1', SLOTS_PER_DAY - 2),
      cellKey(2, 't1', SLOTS_PER_DAY - 1),
    ]);

    assert.deepEqual(cellsToRules(cells, ['t1']), [
      { tableId: 't1', weekday: 2, startMinute: 23 * 60, endMinute: 1440 },
    ]);
  });

  it('столы и дни не смешиваются между собой', () => {
    const cells = new Set([
      cellKey(2, 't1', 30),
      cellKey(2, 't2', 30),
      cellKey(3, 't1', 30),
    ]);

    assert.equal(cellsToRules(cells, ['t1', 't2']).length, 3);
  });

  it('пустая сетка даёт пустое расписание', () => {
    assert.deepEqual(cellsToRules(new Set(), ['t1']), []);
  });

  it('разбор и сборка возвращают исходное расписание', () => {
    const original = [
      rule({ weekday: 1, startMinute: 600, endMinute: 720 }),
      rule({ weekday: 1, tableId: 't2', startMinute: 780, endMinute: 900 }),
      rule({ weekday: 6, startMinute: 0, endMinute: 90 }),
    ];

    const rebuilt = cellsToRules(rulesToCells(original), ['t1', 't2']);

    assert.equal(rebuilt.length, original.length);
    for (const source of original) {
      assert.ok(
        rebuilt.some(
          (item) =>
            item.tableId === source.tableId &&
            item.weekday === source.weekday &&
            item.startMinute === source.startMinute &&
            item.endMinute === source.endMinute,
        ),
        `окно ${source.weekday} ${source.tableId} ${source.startMinute} потерялось`,
      );
    }
  });
});

describe('copyDay', () => {
  it('переносит закрытое время в другой день', () => {
    const cells = new Set([cellKey(1, 't1', 30)]);
    const next = copyDay(cells, 1, [2], ['t1']);

    assert.equal(next.has(cellKey(2, 't1', 30)), true);
    assert.equal(next.has(cellKey(1, 't1', 30)), true);
  });

  it('заменяет день-получатель целиком, а не дополняет его', () => {
    // Иначе «скопировать понедельник на вторник» оставляло бы во вторнике
    // старые окна, и результат не совпадал бы с образцом.
    const cells = new Set([cellKey(1, 't1', 30), cellKey(2, 't1', 10)]);
    const next = copyDay(cells, 1, [2], ['t1']);

    assert.equal(next.has(cellKey(2, 't1', 30)), true);
    assert.equal(next.has(cellKey(2, 't1', 10)), false);
  });

  it('день-образец не трогается, даже если он в списке получателей', () => {
    const cells = new Set([cellKey(1, 't1', 30)]);
    const next = copyDay(cells, 1, [1, 2], ['t1']);

    assert.equal(next.has(cellKey(1, 't1', 30)), true);
  });
});

describe('countClosedSlots', () => {
  it('считает клетки только своего дня', () => {
    const cells = new Set([cellKey(1, 't1', 30), cellKey(1, 't2', 30), cellKey(2, 't1', 30)]);

    assert.equal(countClosedSlots(cells, 1), 2);
    assert.equal(countClosedSlots(cells, 2), 1);
    assert.equal(countClosedSlots(cells, 3), 0);
  });
});
