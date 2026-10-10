import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dayIn, timeIn, viewerTime } from './zonedTime.ts';

const KRSK = 'Asia/Krasnoyarsk';
const MSK = 'Europe/Moscow';

describe('timeIn и dayIn', () => {
  it('показывают часы и дату зала, а не браузера', () => {
    // 11:00 UTC — 18:00 в Красноярске и 14:00 в Москве.
    assert.equal(timeIn('2026-10-07T11:00:00Z', KRSK), '18:00');
    assert.equal(timeIn('2026-10-07T11:00:00Z', MSK), '14:00');
    assert.equal(dayIn('2026-10-07T18:00:00Z', KRSK), '2026-10-08');
  });

  it('полночь — 00:00, а не 24:00', () => {
    assert.equal(timeIn('2026-10-07T17:00:00Z', KRSK), '00:00');
  });
});

describe('viewerTime', () => {
  it('смотрящий в том же поясе второй строки не получает', () => {
    assert.equal(viewerTime('2026-10-07T11:00:00Z', '2026-10-07T12:30:00Z', KRSK, KRSK), null);
  });

  it('другой пояс с теми же часами — тоже нет', () => {
    assert.equal(viewerTime('2026-10-07T11:00:00Z', null, KRSK, 'Asia/Novokuznetsk'), null);
  });

  it('из Москвы — время по его часам', () => {
    assert.equal(viewerTime('2026-10-07T11:00:00Z', '2026-10-07T12:30:00Z', KRSK, MSK), 'у вас 14:00–15:30');
    assert.equal(viewerTime('2026-10-07T11:00:00Z', null, KRSK, MSK), 'у вас 14:00');
  });

  it('если у смотрящего другой день, он назван', () => {
    // 01:00 восьмого в Красноярске — 21:00 седьмого в Москве.
    assert.equal(viewerTime('2026-10-07T18:00:00Z', null, KRSK, MSK), 'у вас 7 окт., 21:00');
  });
});
