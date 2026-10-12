import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';
import {
  bookableWindow,
  openState,
  openStateLabel,
  outsideHoursProblem,
  parseWorkingHours,
  workingHoursLines,
} from '@yenisey/types';

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

describe('openState', () => {
  // Пн–Пт 08:00–23:00, Сб 10:00–24:00, Вс выходной.
  const hours = [...weekdays, day('10:00', '24:00'), null];
  const tz = 'Asia/Krasnoyarsk'; // UTC+7
  // 2026-09-28 — понедельник.
  const at = (iso: string) => new Date(iso);

  it('открыто — до закрытия', () => {
    const state = openState(hours, at('2026-09-28T05:00:00Z'), tz); // пн 12:00

    assert.deepEqual(state, { open: true, closesAt: '23:00' });
    assert.equal(openStateLabel(state!), 'Открыто до 23:00');
  });

  it('утром до открытия — сегодня', () => {
    const state = openState(hours, at('2026-09-27T23:30:00Z'), tz); // пн 06:30

    assert.deepEqual(state, { open: false, opensAt: { weekday: 0, time: '08:00', inDays: 0 } });
    assert.equal(openStateLabel(state!), 'Закрыто · откроется в 08:00');
  });

  it('после закрытия — завтра; перед выходным — через день', () => {
    assert.equal(openStateLabel(openState(hours, at('2026-09-28T16:30:00Z'), tz)!), 'Закрыто · откроется завтра в 08:00');
    // Вс 12:00 — выходной, дальше пн.
    assert.equal(openStateLabel(openState(hours, at('2026-10-04T05:00:00Z'), tz)!), 'Закрыто · откроется завтра в 08:00');
    // Сб 23:59 — до полуночи ещё открыто.
    assert.equal(openStateLabel(openState(hours, at('2026-10-03T16:59:00Z'), tz)!), 'Открыто до полуночи');
  });

  it('пояс — зала, а не смотрящего', () => {
    // 16:30 UTC: в Красноярске 23:30 — закрыто, в Москве 19:30 — открыто.
    assert.equal(openState(hours, at('2026-09-28T16:30:00Z'), tz)!.open, false);
    assert.equal(openState(hours, at('2026-09-28T16:30:00Z'), 'Europe/Moscow')!.open, true);
  });

  it('часы не указаны — null', () => {
    assert.equal(openState(null, new Date(), tz), null);
  });
});

test('окно брони клиента — часы зала внутри сетки и по шагу', () => {
  const grid = { openMinute: 6 * 60, closeMinute: 24 * 60, stepMinutes: 30 };
  const workday = { open: '08:15', close: '22:50' };
  // 2026-10-12 — понедельник, 2026-10-18 — воскресенье.
  const hours = [workday, workday, workday, workday, workday, { open: '05:00', close: '24:00' }, null];

  assert.deepEqual(bookableWindow(null, '2026-10-12', grid), { openMinute: 360, closeMinute: 1440, closedDay: false });
  assert.deepEqual(bookableWindow(hours, '2026-10-12', grid), { openMinute: 510, closeMinute: 1350, closedDay: false });
  // Раньше сетки зал открыт — сетка всё равно с 06:00.
  assert.deepEqual(bookableWindow(hours, '2026-10-17', grid), { openMinute: 360, closeMinute: 1440, closedDay: false });
  assert.equal(bookableWindow(hours, '2026-10-18', grid).closedDay, true);
});

test('бронь вне часов работы — понятный отказ', () => {
  const window = { openMinute: 510, closeMinute: 1350, closedDay: false };

  assert.equal(outsideHoursProblem(window, 510, 60), null);
  assert.equal(outsideHoursProblem(window, 1290, 60), null);
  assert.match(outsideHoursProblem(window, 480, 60) ?? '', /с 08:30 до 22:30/);
  assert.match(outsideHoursProblem(window, 1320, 60) ?? '', /с 08:30 до 22:30/);
  assert.match(outsideHoursProblem({ ...window, closedDay: true }, 600, 60) ?? '', /не работает/);
});
