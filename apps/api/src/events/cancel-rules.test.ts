import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cancelProblem, type CancellableEvent } from './cancel-rules.ts';

const START = new Date('2026-10-12T11:00:00Z');
const END = new Date('2026-10-12T12:30:00Z');

const event = (over: Partial<CancellableEvent> = {}): CancellableEvent => ({
  endsAt: END,
  cancelledAt: null,
  ...over,
});

describe('cancelProblem', () => {
  it('до начала с причиной — можно', () => {
    assert.equal(cancelProblem(event(), new Date('2026-10-11T20:00:00Z'), 'Тренер заболел'), null);
  });

  it('после начала, но до окончания — тоже можно', () => {
    assert.equal(cancelProblem(event(), new Date(START.getTime() + 30 * 60_000), 'Отключили свет'), null);
  });

  it('в момент окончания и позже — нельзя', () => {
    assert.equal(cancelProblem(event(), END, 'Поздно')?.status, 400);
    assert.equal(cancelProblem(event(), new Date(END.getTime() + 60_000), 'Поздно')?.status, 400);
  });

  it('уже отменённое — 409, раньше прочих проверок', () => {
    const problem = cancelProblem(event({ cancelledAt: START }), new Date(END.getTime() + 1), '');

    assert.equal(problem?.status, 409);
  });

  it('причина обязательна и считается без пустых краёв', () => {
    const now = new Date('2026-10-11T20:00:00Z');

    assert.equal(cancelProblem(event(), now, '')?.status, 400);
    assert.equal(cancelProblem(event(), now, '   ab  ')?.status, 400);
    assert.equal(cancelProblem(event(), now, '  abc  '), null);
  });

  it('причина не длиннее 300 знаков', () => {
    const now = new Date('2026-10-11T20:00:00Z');

    assert.equal(cancelProblem(event(), now, 'я'.repeat(300)), null);
    assert.equal(cancelProblem(event(), now, 'я'.repeat(301))?.status, 400);
  });
});
