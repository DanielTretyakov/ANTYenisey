import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClosureRule } from '@yenisey/types';
import {
  closedByRules,
  findOverlap,
  formatMinutes,
  localParts,
  localSegments,
  overlaps,
} from './closures.ts';

const KRSK = 'Asia/Krasnoyarsk';

/** Правило «стол закрыт в такой-то день с такого-то часа». */
function rule(overrides: Partial<ClosureRule> = {}): ClosureRule {
  return {
    id: 'r1',
    tableId: 't1',
    weekday: 2,
    startMinute: 15 * 60,
    endMinute: 19 * 60,
    ...overrides,
  };
}

describe('localParts', () => {
  it('переводит мгновение UTC во время клуба', () => {
    // 2026-03-10 — вторник. 08:00 UTC в Красноярске (UTC+7) — это 15:00.
    const parts = localParts(new Date('2026-03-10T08:00:00Z'), KRSK);

    assert.equal(parts.weekday, 2);
    assert.equal(parts.date, '2026-03-10');
    assert.equal(parts.minutes, 15 * 60);
  });

  it('день недели берётся местный, а не UTC', () => {
    // 22:00 UTC вторника — это уже 05:00 среды в Красноярске. Правило среды
    // должно применяться, вторника — нет.
    const parts = localParts(new Date('2026-03-10T22:00:00Z'), KRSK);

    assert.equal(parts.weekday, 3);
    assert.equal(parts.date, '2026-03-11');
    assert.equal(parts.minutes, 5 * 60);
  });

  it('полночь — это ноль минут, а не 1440', () => {
    // 17:00 UTC = 00:00 следующего дня в Красноярске.
    assert.equal(localParts(new Date('2026-03-10T17:00:00Z'), KRSK).minutes, 0);
  });

  it('воскресенье — седьмой день, а не нулевой', () => {
    // 2026-03-15 — воскресенье.
    assert.equal(localParts(new Date('2026-03-15T08:00:00Z'), KRSK).weekday, 7);
  });
});

describe('localSegments', () => {
  it('промежуток внутри одних суток — один отрезок', () => {
    const segments = localSegments(
      new Date('2026-03-10T08:00:00Z'),
      new Date('2026-03-10T09:00:00Z'),
      KRSK,
    );

    assert.deepEqual(segments, [{ weekday: 2, startMinute: 900, endMinute: 960 }]);
  });

  it('переход через местную полночь даёт два отрезка разных дней', () => {
    // 23:30 вторника — 00:30 среды по Красноярску.
    const segments = localSegments(
      new Date('2026-03-10T16:30:00Z'),
      new Date('2026-03-10T17:30:00Z'),
      KRSK,
    );

    assert.deepEqual(segments, [
      { weekday: 2, startMinute: 1410, endMinute: 1440 },
      { weekday: 3, startMinute: 0, endMinute: 30 },
    ]);
  });

  it('ровно до полуночи — один отрезок, пустого хвоста нет', () => {
    // Пустой отрезок следующего дня ловил бы ложные пересечения с правилами,
    // начинающимися в 00:00.
    const segments = localSegments(
      new Date('2026-03-10T16:00:00Z'),
      new Date('2026-03-10T17:00:00Z'),
      KRSK,
    );

    assert.deepEqual(segments, [{ weekday: 2, startMinute: 1380, endMinute: 1440 }]);
  });
});

describe('overlaps', () => {
  it('стык пересечением не считается', () => {
    assert.equal(overlaps(900, 960, 960, 1020), false);
    assert.equal(overlaps(960, 1020, 900, 960), false);
  });

  it('частичное наложение и вложенность считаются', () => {
    assert.equal(overlaps(900, 960, 930, 990), true);
    assert.equal(overlaps(900, 990, 930, 960), true);
    assert.equal(overlaps(930, 960, 900, 990), true);
  });
});

describe('closedByRules', () => {
  const rules = [rule()];

  it('бронь внутри закрытого окна отклоняется', () => {
    assert.equal(
      closedByRules(
        rules,
        't1',
        new Date('2026-03-10T09:00:00Z'), // 16:00 вторника
        new Date('2026-03-10T10:00:00Z'),
        KRSK,
      ),
      true,
    );
  });

  it('бронь встык с закрытым окном разрешена', () => {
    // Окно закрыто до 19:00; бронь с 19:00 занимает уже свободное время.
    assert.equal(
      closedByRules(
        rules,
        't1',
        new Date('2026-03-10T12:00:00Z'),
        new Date('2026-03-10T13:00:00Z'),
        KRSK,
      ),
      false,
    );
  });

  it('правило одного стола не закрывает соседний', () => {
    assert.equal(
      closedByRules(
        rules,
        't2',
        new Date('2026-03-10T09:00:00Z'),
        new Date('2026-03-10T10:00:00Z'),
        KRSK,
      ),
      false,
    );
  });

  it('то же время другого дня недели свободно', () => {
    // Среда, 16:00 — правило заведено на вторник.
    assert.equal(
      closedByRules(
        rules,
        't1',
        new Date('2026-03-11T09:00:00Z'),
        new Date('2026-03-11T10:00:00Z'),
        KRSK,
      ),
      false,
    );
  });

  it('бронь через полночь ловится правилом следующего дня', () => {
    // 23:30 понедельника — 00:30 вторника; правило вторника с 00:00.
    const midnightRule = [rule({ weekday: 2, startMinute: 0, endMinute: 60 })];

    assert.equal(
      closedByRules(
        midnightRule,
        't1',
        new Date('2026-03-09T16:30:00Z'),
        new Date('2026-03-09T17:30:00Z'),
        KRSK,
      ),
      true,
    );
  });

  it('часовой пояс клуба решает, в какой день попала бронь', () => {
    // Тот же мгновенный промежуток: в Красноярске это среда, в Москве —
    // ещё вторник, и правило вторника его закрывает.
    const from = new Date('2026-03-10T20:00:00Z');
    const to = new Date('2026-03-10T21:00:00Z');
    const lateRule = [rule({ weekday: 2, startMinute: 23 * 60, endMinute: 1440 })];

    assert.equal(closedByRules(lateRule, 't1', from, to, 'Europe/Moscow'), true);
    assert.equal(closedByRules(lateRule, 't1', from, to, KRSK), false);
  });
});

describe('findOverlap', () => {
  it('на непересекающемся расписании возвращает null', () => {
    assert.equal(
      findOverlap([
        { tableId: 't1', weekday: 2, startMinute: 600, endMinute: 720 },
        { tableId: 't1', weekday: 2, startMinute: 720, endMinute: 840 },
        { tableId: 't1', weekday: 3, startMinute: 600, endMinute: 720 },
        { tableId: 't2', weekday: 2, startMinute: 600, endMinute: 720 },
      ]),
      null,
    );
  });

  it('находит наложение в пределах одного стола и дня', () => {
    const found = findOverlap([
      { tableId: 't1', weekday: 2, startMinute: 600, endMinute: 780 },
      { tableId: 't1', weekday: 2, startMinute: 720, endMinute: 840 },
    ]);

    assert.notEqual(found, null);
    assert.equal(found?.[0].startMinute, 600);
    assert.equal(found?.[1].startMinute, 720);
  });
});

describe('formatMinutes', () => {
  it('показывает время с ведущими нулями', () => {
    assert.equal(formatMinutes(0), '00:00');
    assert.equal(formatMinutes(9 * 60 + 5), '09:05');
    assert.equal(formatMinutes(15 * 60), '15:00');
  });

  it('конец суток показывает как 24:00, а не 00:00', () => {
    // 1440 — это конец окна, и подменять его полуночью значит показать
    // администратору пустой интервал «23:00–00:00».
    assert.equal(formatMinutes(1440), '24:00');
  });
});
