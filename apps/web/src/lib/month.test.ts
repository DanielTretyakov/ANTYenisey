import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dayKey, monthEnd, monthGrid, monthLabel, monthStart } from './month.ts';

describe('monthGrid', () => {
  it('сентябрь 2026: с понедельника 31 августа по воскресенье 4 октября', () => {
    const grid = monthGrid(new Date(2026, 8, 1));

    assert.equal(grid.length, 35);
    assert.equal(dayKey(grid[0]!.date), '2026-08-31');
    assert.equal(grid[0]!.inMonth, false);
    assert.equal(dayKey(grid[1]!.date), '2026-09-01');
    assert.equal(dayKey(grid.at(-1)!.date), '2026-10-04');
    assert.equal(grid.filter((cell) => cell.inMonth).length, 30);
  });

  it('месяц с понедельника — без хвоста слева', () => {
    // 1 июня 2026 — понедельник.
    const grid = monthGrid(new Date(2026, 5, 1));
    assert.equal(dayKey(grid[0]!.date), '2026-06-01');
    assert.equal(grid.length % 7, 0);
  });

  it('месяц из 31 дня, начавшийся в воскресенье, растягивается на шесть недель', () => {
    // 1 марта 2026 — воскресенье.
    const grid = monthGrid(new Date(2026, 2, 1));
    assert.equal(grid.length, 42);
  });
});

describe('monthStart и monthEnd', () => {
  it('смещение через год', () => {
    const start = monthStart(new Date(2026, 11, 20), 1);
    assert.equal(dayKey(start), '2027-01-01');
    assert.equal(dayKey(monthEnd(start)), '2027-02-01');
  });
});

describe('monthLabel', () => {
  it('с заглавной и без «г.»', () => {
    assert.equal(monthLabel(new Date(2026, 9, 1)), 'Октябрь 2026');
  });
});
