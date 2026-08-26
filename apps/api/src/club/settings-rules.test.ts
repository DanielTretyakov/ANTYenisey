import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClubSettings, Hall } from '@yenisey/types';
import { clubSettingsViolations, hallViolations, isValidTimezone } from './settings-rules.ts';

/** Настройки клуба «Енисей» из ТЗ — точка отсчёта для точечных отклонений. */
function settings(overrides: Partial<ClubSettings> = {}): ClubSettings {
  return {
    name: 'АНТ «Енисей»',
    timezone: 'Asia/Krasnoyarsk',
    noShowChargePercent: 100,
    attendanceReminderAfterMinutes: 60,
    attendanceAutoNoShowAfterMinutes: 1440,
    subscriptionBurnsOnNoShowOnly: true,
    ...overrides,
  };
}

/** Основной зал «Енисея» с ценами из прайса. */
function hall(overrides: Partial<Hall> = {}): Omit<Hall, 'id'> {
  return {
    name: 'Основной зал',
    bookingStep: 'MIN_30',
    tableHourPrice: 40_000,
    tableExtra30MinPrice: 20_000,
    hasRobotOption: false,
    robot30MinPrice: null,
    robot60MinPrice: null,
    robotExtra30MinPrice: null,
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

describe('clubSettingsViolations', () => {
  it('на настройках «Енисея» замечаний нет', () => {
    assert.deepEqual(clubSettingsViolations(settings()), []);
  });

  it('неявка, зафиксированная раньше напоминания, отклоняется', () => {
    const violations = clubSettingsViolations(
      settings({ attendanceReminderAfterMinutes: 120, attendanceAutoNoShowAfterMinutes: 60 }),
    );

    assert.equal(violations.length, 1);
    assert.match(violations[0]!, /позже напоминания/);
  });

  it('совпадение сроков тоже отклоняется — эскалация теряет смысл', () => {
    assert.equal(
      clubSettingsViolations(
        settings({ attendanceReminderAfterMinutes: 60, attendanceAutoNoShowAfterMinutes: 60 }),
      ).length,
      1,
    );
  });

  it('нарушения возвращаются все разом, а не по одному', () => {
    const violations = clubSettingsViolations(
      settings({
        timezone: 'Asia/Krasnayarsk',
        attendanceReminderAfterMinutes: 120,
        attendanceAutoNoShowAfterMinutes: 60,
      }),
    );

    assert.equal(violations.length, 2);
  });
});

describe('hallViolations', () => {
  it('на основном зале «Енисея» замечаний нет', () => {
    assert.deepEqual(hallViolations(hall()), []);
  });

  it('опция робота без цен отклоняется, и в тексте перечислено чего не хватает', () => {
    const violations = hallViolations(hall({ hasRobotOption: true }));

    assert.equal(violations.length, 1);
    assert.match(violations[0]!, /30 минут/);
    assert.match(violations[0]!, /60 минут/);
    assert.match(violations[0]!, /каждые следующие 30 минут/);
  });

  it('названа именно недостающая цена, а не весь набор', () => {
    const violations = hallViolations(
      hall({
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
    assert.deepEqual(hallViolations(hall({ hasRobotOption: false })), []);
  });

  it('нулевая цена робота — это заданная цена, а не отсутствующая', () => {
    // Бесплатный робот в акции — законная настройка. Проверка смотрит на null,
    // а не на «ложное» значение, и 0 её проходить обязан.
    assert.deepEqual(
      hallViolations(
        hall({
          hasRobotOption: true,
          robot30MinPrice: 0,
          robot60MinPrice: 0,
          robotExtra30MinPrice: 0,
        }),
      ),
      [],
    );
  });

  it('зал без названия отклоняется', () => {
    assert.equal(hallViolations(hall({ name: '   ' })).length, 1);
  });
});
