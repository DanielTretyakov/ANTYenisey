import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clubTops, periodStart, ranked } from './rating-rules.ts';

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

describe('clubTops', () => {
  const names: Record<string, string> = { a: 'Енисей', b: 'Саяны', c: 'Бирюса', d: 'Ангара' };
  const nameOf = (id: string) => names[id]!;
  const today = () => '2026-09-30';
  const days = [
    // «Енисей»: два дня в сентябре, один в марте, один в прошлом году.
    { tenantId: 'a', date: '2026-09-02' },
    { tenantId: 'a', date: '2026-09-15' },
    { tenantId: 'a', date: '2026-03-01' },
    { tenantId: 'a', date: '2025-12-31' },
    // «Саяны»: три дня в августе.
    { tenantId: 'b', date: '2026-08-01' },
    { tenantId: 'b', date: '2026-08-02' },
    { tenantId: 'b', date: '2026-08-03' },
    // Повтор одного дня — один визит.
    { tenantId: 'c', date: '2026-09-10' },
    { tenantId: 'c', date: '2026-09-10' },
    { tenantId: 'd', date: '2024-01-01' },
  ];

  it('месяц, год и всё время — каждый со своим отбором', () => {
    const tops = clubTops(days, today, nameOf);

    assert.deepEqual(
      tops.month.map((row) => [row.name, row.visits, row.place]),
      [
        ['Енисей', 2, 1],
        ['Бирюса', 1, 2],
      ],
    );
    assert.deepEqual(
      tops.year.map((row) => [row.name, row.visits]),
      [
        ['Енисей', 3],
        ['Саяны', 3],
        ['Бирюса', 1],
      ],
    );
    // Равные по визитам — по названию: «Ангара» раньше «Бирюсы», и третьей
    // строкой проходит она.
    assert.deepEqual(
      tops.all.map((row) => row.name),
      ['Енисей', 'Саяны', 'Ангара'],
    );
  });

  it('«сегодня» у каждого клуба своё', () => {
    // В клубе a уже октябрь, в остальных ещё сентябрь.
    const tops = clubTops(days, (id) => (id === 'a' ? '2026-10-01' : '2026-09-30'), nameOf);

    assert.deepEqual(
      tops.month.map((row) => row.name),
      ['Бирюса'],
    );
  });

  it('без визитов — пусто', () => {
    assert.deepEqual(clubTops([], today, nameOf), { month: [], year: [], all: [] });
  });
});
