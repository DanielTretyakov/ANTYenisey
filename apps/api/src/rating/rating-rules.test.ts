import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { periodStart, ranked } from './rating-rules.ts';

describe('periodStart', () => {
  it('месяц и год — календарные, всё время — без начала', () => {
    assert.equal(periodStart('month', '2026-09-26'), '2026-09-01');
    assert.equal(periodStart('year', '2026-09-26'), '2026-01-01');
    assert.equal(periodStart('all', '2026-09-26'), null);
  });
});

describe('ranked', () => {
  it('равные делят место, следующий — через занятые', () => {
    const rows = ranked([
      { name: 'Борисов Б.', visits: 5 },
      { name: 'Андреев А.', visits: 9 },
      { name: 'Власов В.', visits: 5 },
      { name: 'Громов Г.', visits: 2 },
    ]);

    assert.deepEqual(
      rows.map((row) => [row.place, row.name]),
      [
        [1, 'Андреев А.'],
        [2, 'Борисов Б.'],
        [2, 'Власов В.'],
        [4, 'Громов Г.'],
      ],
    );
  });

  it('пустой рейтинг — пустой', () => {
    assert.deepEqual(ranked([]), []);
  });
});
