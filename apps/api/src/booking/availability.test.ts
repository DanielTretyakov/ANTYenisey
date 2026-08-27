import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bookingViolation,
  cancellationPercent,
  CLOSE_MINUTE,
  mergeBusy,
  OPEN_MINUTE,
  STEP_MINUTES,
} from './availability.ts';

describe('mergeBusy', () => {
  it('склеивает пересекающиеся промежутки', () => {
    assert.deepEqual(
      mergeBusy([
        { startMinute: 600, endMinute: 720 },
        { startMinute: 660, endMinute: 780 },
      ]),
      [{ startMinute: 600, endMinute: 780 }],
    );
  });

  it('склеивает смежные: щели между ними нет', () => {
    assert.deepEqual(
      mergeBusy([
        { startMinute: 600, endMinute: 660 },
        { startMinute: 660, endMinute: 720 },
      ]),
      [{ startMinute: 600, endMinute: 720 }],
    );
  });

  it('оставляет раздельными те, между которыми стол свободен', () => {
    assert.deepEqual(
      mergeBusy([
        { startMinute: 660, endMinute: 720 },
        { startMinute: 600, endMinute: 630 },
      ]),
      [
        { startMinute: 600, endMinute: 630 },
        { startMinute: 660, endMinute: 720 },
      ],
    );
  });

  it('не трогает исходный список', () => {
    const source = [{ startMinute: 600, endMinute: 660 }];
    mergeBusy(source);

    assert.deepEqual(source, [{ startMinute: 600, endMinute: 660 }]);
  });
});

describe('bookingViolation', () => {
  const base = {
    startMinute: 10 * 60,
    durationMinutes: 60,
    stepMinutes: 30,
    earliestMinute: OPEN_MINUTE,
    busy: [],
  };

  it('пропускает бронь на свободное время', () => {
    assert.equal(bookingViolation(base), null);
  });

  it('требует длительность, кратную шагу зала', () => {
    assert.match(
      bookingViolation({ ...base, durationMinutes: 45 }) ?? '',
      /кратна 30 минутам/,
    );
  });

  it('требует начало по шагу зала', () => {
    assert.match(bookingViolation({ ...base, startMinute: 10 * 60 + 10 }) ?? '', /шага в 30 минут/);
  });

  it('не выпускает бронь за границы дня', () => {
    assert.match(bookingViolation({ ...base, startMinute: 5 * 60 }) ?? '', /с 06:00 до полуночи/);
    assert.match(
      bookingViolation({ ...base, startMinute: CLOSE_MINUTE - 30, durationMinutes: 60 }) ?? '',
      /с 06:00 до полуночи/,
    );
  });

  it('пускает бронь, кончающуюся ровно в полночь', () => {
    assert.equal(
      bookingViolation({ ...base, startMinute: CLOSE_MINUTE - 60, durationMinutes: 60 }),
      null,
    );
  });

  it('не отдаёт время, которое уже прошло', () => {
    assert.match(
      bookingViolation({ ...base, earliestMinute: 11 * 60 }) ?? '',
      /уже прошло/,
    );
  });

  it('не отдаёт занятое время', () => {
    assert.match(
      bookingViolation({ ...base, busy: [{ startMinute: 10 * 60 + 30, endMinute: 12 * 60 }] }) ?? '',
      /уже занят/,
    );
  });

  it('стык занятости пересечением не считается', () => {
    assert.equal(
      bookingViolation({ ...base, busy: [{ startMinute: 11 * 60, endMinute: 12 * 60 }] }),
      null,
    );
    assert.equal(
      bookingViolation({ ...base, busy: [{ startMinute: 9 * 60, endMinute: 10 * 60 }] }),
      null,
    );
  });
});

describe('cancellationPercent', () => {
  /** Политика «Енисея» из ТЗ: за час и раньше — 0%, позже — 50%. */
  const YENISEY = [
    { minMinutesBeforeStart: 60, chargePercent: 0 },
    { minMinutesBeforeStart: 0, chargePercent: 50 },
  ];

  it('за час и раньше не списывает ничего', () => {
    assert.equal(cancellationPercent(YENISEY, 60), 0);
    assert.equal(cancellationPercent(YENISEY, 600), 0);
  });

  it('позже часа списывает половину', () => {
    assert.equal(cancellationPercent(YENISEY, 59), 50);
    assert.equal(cancellationPercent(YENISEY, 0), 50);
  });

  it('ступени берутся по порогу, а не по порядку в списке', () => {
    assert.equal(cancellationPercent([...YENISEY].reverse(), 120), 0);
  });

  it('клуб без политики не списывает ничего', () => {
    assert.equal(cancellationPercent([], 5), 0);
  });
});

describe('STEP_MINUTES', () => {
  it('шаг зала делит границу открытия нацело', () => {
    // Иначе сетка, начинающаяся в 06:00, не совпала бы с выравниванием брони
    // по полуночи, и первая клетка дня оказалась бы недоступной.
    for (const minutes of Object.values(STEP_MINUTES)) {
      assert.equal(OPEN_MINUTE % minutes, 0, `шаг ${minutes} не делит 06:00 нацело`);
    }
  });
});
