import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClubSettings } from '@yenisey/types';
import { isValidTimezone, settingsViolations } from './settings-rules.ts';

/** Настройки «Енисея» из ТЗ — точка отсчёта для точечных отклонений. */
function settings(overrides: Partial<ClubSettings> = {}): ClubSettings {
  return {
    name: 'АНТ «Енисей»',
    timezone: 'Asia/Krasnoyarsk',
    bookingStep: 'MIN_30',
    tableHourPrice: 40_000,
    tableExtra30MinPrice: 20_000,
    hasRobotOption: false,
    robot30MinPrice: null,
    robot60MinPrice: null,
    robotExtra30MinPrice: null,
    noShowChargePercent: 100,
    attendanceReminderAfterMinutes: 60,
    attendanceAutoNoShowAfterMinutes: 1440,
    subscriptionBurnsOnNoShowOnly: true,
    ...overrides,
  };
}

describe('isValidTimezone', () => {
  it('принимает настоящие зоны IANA', () => {
    assert.equal(isValidTimezone('Asia/Krasnoyarsk'), true);
    assert.equal(isValidTimezone('Europe/Kaliningrad'), true);
    assert.equal(isValidTimezone('UTC'), true);
  });

  it('отклоняет опечатку, похожую на настоящую зону', () => {
    // Ровно тот случай, ради которого проверка и заведена: строка выглядит
    // правдоподобно и молча сломала бы расчёт порога отмены.
    assert.equal(isValidTimezone('Asia/Krasnayarsk'), false);
  });

  it('отклоняет мусор и пустую строку', () => {
    assert.equal(isValidTimezone('Красноярск'), false);
    assert.equal(isValidTimezone(''), false);
  });
});

describe('settingsViolations', () => {
  it('на настройках «Енисея» замечаний нет', () => {
    assert.deepEqual(settingsViolations(settings()), []);
  });

  it('опция робота без цен отклоняется, и в тексте перечислено чего не хватает', () => {
    const violations = settingsViolations(settings({ hasRobotOption: true }));

    assert.equal(violations.length, 1);
    assert.match(violations[0]!, /30 минут/);
    assert.match(violations[0]!, /60 минут/);
    assert.match(violations[0]!, /каждые следующие 30 минут/);
  });

  it('названа именно недостающая цена, а не весь набор', () => {
    const violations = settingsViolations(
      settings({
        hasRobotOption: true,
        robot30MinPrice: 30_000,
        robot60MinPrice: 50_000,
        robotExtra30MinPrice: null,
      }),
    );

    assert.equal(violations.length, 1);
    assert.doesNotMatch(violations[0]!, /60 минут/);
    assert.match(violations[0]!, /каждые следующие 30 минут/);
  });

  it('выключенная опция робота цен не требует', () => {
    assert.deepEqual(settingsViolations(settings({ hasRobotOption: false })), []);
  });

  it('нулевая цена робота — это заданная цена, а не отсутствующая', () => {
    // Бесплатный робот в акции — законная настройка. Проверка смотрит на null,
    // а не на «ложное» значение, и 0 её проходить обязан.
    assert.deepEqual(
      settingsViolations(
        settings({
          hasRobotOption: true,
          robot30MinPrice: 0,
          robot60MinPrice: 0,
          robotExtra30MinPrice: 0,
        }),
      ),
      [],
    );
  });

  it('неявка, зафиксированная раньше напоминания, отклоняется', () => {
    const violations = settingsViolations(
      settings({ attendanceReminderAfterMinutes: 120, attendanceAutoNoShowAfterMinutes: 60 }),
    );

    assert.equal(violations.length, 1);
    assert.match(violations[0]!, /позже напоминания/);
  });

  it('совпадение сроков тоже отклоняется — эскалация теряет смысл', () => {
    const violations = settingsViolations(
      settings({ attendanceReminderAfterMinutes: 60, attendanceAutoNoShowAfterMinutes: 60 }),
    );

    assert.equal(violations.length, 1);
  });

  it('нарушения возвращаются все разом, а не по одному', () => {
    const violations = settingsViolations(
      settings({
        timezone: 'Asia/Krasnayarsk',
        hasRobotOption: true,
        attendanceReminderAfterMinutes: 120,
        attendanceAutoNoShowAfterMinutes: 60,
      }),
    );

    assert.equal(violations.length, 3);
  });
});
