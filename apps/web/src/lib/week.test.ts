import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sameDay, weekDays, weekEnd, weekLabel, weekStart } from './week.ts';

describe('weekStart', () => {
  it('неделя начинается с понедельника', () => {
    // 24.09.2026 — четверг.
    const start = weekStart(new Date(2026, 8, 24, 15, 30));
    assert.equal(start.getDay(), 1);
    assert.ok(sameDay(start, new Date(2026, 8, 21)));
    assert.equal(start.getHours(), 0);
  });

  it('воскресенье — последний день своей недели, а не первый следующей', () => {
    assert.ok(sameDay(weekStart(new Date(2026, 8, 27, 23, 0)), new Date(2026, 8, 21)));
  });

  it('сдвиг — целыми неделями, через границу месяца', () => {
    assert.ok(sameDay(weekStart(new Date(2026, 8, 24), 2), new Date(2026, 9, 5)));
  });
});

describe('weekDays и weekEnd', () => {
  it('семь дней подряд, конец — следующий понедельник', () => {
    const start = weekStart(new Date(2026, 8, 24));
    const days = weekDays(start);
    assert.equal(days.length, 7);
    assert.ok(sameDay(days[6]!, new Date(2026, 8, 27)));
    assert.ok(sameDay(weekEnd(start), new Date(2026, 8, 28)));
  });
});

describe('weekLabel', () => {
  it('внутри месяца — месяц один раз', () => {
    assert.equal(weekLabel(new Date(2026, 8, 21)), '21–27 сентября');
  });

  it('через границу месяца — оба', () => {
    assert.equal(weekLabel(new Date(2026, 8, 28)), '28 сентября – 4 октября');
  });
});
