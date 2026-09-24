import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { distinctNearest } from './feed-rules.ts';

const row = (startsAt: string, sameAs: string) => ({ startsAt, sameAs });

describe('distinctNearest', () => {
  it('от повторяющегося — только ближайшее проведение', () => {
    const rows = [
      row('2026-09-29T11:00:00Z', 'a:TRAINING:group'),
      row('2026-09-26T11:00:00Z', 'a:TRAINING:group'),
      row('2026-09-27T08:00:00Z', 'a:TOURNAMENT:cup'),
    ];

    assert.deepEqual(distinctNearest(rows, 5), [
      row('2026-09-26T11:00:00Z', 'a:TRAINING:group'),
      row('2026-09-27T08:00:00Z', 'a:TOURNAMENT:cup'),
    ]);
  });

  it('тот же тип в другом клубе — не повтор', () => {
    const rows = [row('2026-09-26T11:00:00Z', 'a:TRAINING:group'), row('2026-09-26T12:00:00Z', 'b:TRAINING:group')];

    assert.equal(distinctNearest(rows, 5).length, 2);
  });

  it('не больше предела, по времени', () => {
    const rows = ['e', 'd', 'c', 'b', 'a'].map((key, index) => row(`2026-10-0${index + 1}T10:00:00Z`, key));

    assert.deepEqual(
      distinctNearest(rows, 3).map((item) => item.sameAs),
      ['e', 'd', 'c'],
    );
  });
});
