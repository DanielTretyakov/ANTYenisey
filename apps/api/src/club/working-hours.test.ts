import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseWorkingHours, workingHoursLines } from '@yenisey/types';

const day = (open: string, close: string) => ({ open, close });
const weekdays = [0, 1, 2, 3, 4].map(() => day('08:00', '23:00'));

describe('parseWorkingHours', () => {
  it('неделя с выходными и «до полуночи»', () => {
    const parsed = parseWorkingHours([...weekdays, day('10:00', '24:00'), null]);

    assert.ok(parsed.ok);
    assert.equal(parsed.value?.[5]?.close, '24:00');
    assert.equal(parsed.value?.[6], null);
  });

  it('лишние поля отбрасываются', () => {
    const parsed = parseWorkingHours([...weekdays, { open: '10:00', close: '22:00', x: 1 }, null]);

    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value?.[5], { open: '10:00', close: '22:00' });
  });

  it('открытие позже закрытия, кривое время и не семь дней — отказ', () => {
    assert.equal(parseWorkingHours([...weekdays, day('22:00', '02:00'), null]).ok, false);
    assert.equal(parseWorkingHours([...weekdays, day('8:00', '22:00'), null]).ok, false);
    assert.equal(parseWorkingHours([...weekdays, day('10:00', '24:30'), null]).ok, false);
    assert.equal(parseWorkingHours(weekdays).ok, false);
  });

  it('все выходные и пусто — «не указано»', () => {
    assert.deepEqual(parseWorkingHours([null, null, null, null, null, null, null]), { ok: true, value: null });
    assert.deepEqual(parseWorkingHours(null), { ok: true, value: null });
  });
});

describe('workingHoursLines', () => {
  it('одинаковые дни подряд — одним диапазоном', () => {
    assert.deepEqual(workingHoursLines([...weekdays, day('10:00', '22:00'), day('10:00', '22:00')]), [
      'Пн–Пт 08:00–23:00',
      'Сб–Вс 10:00–22:00',
    ]);
  });

  it('каждый день одинаково — «ежедневно», выходной назван', () => {
    assert.deepEqual(workingHoursLines(Array.from({ length: 7 }, () => day('09:00', '21:00'))), ['Ежедневно 09:00–21:00']);
    assert.deepEqual(workingHoursLines([...weekdays.slice(0, 2), null, ...weekdays.slice(0, 2), null, null]), [
      'Пн–Вт 08:00–23:00',
      'Ср выходной',
      'Чт–Пт 08:00–23:00',
      'Сб–Вс выходной',
    ]);
  });

  it('не указано — пусто', () => {
    assert.deepEqual(workingHoursLines(null), []);
  });
});
