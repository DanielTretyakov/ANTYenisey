import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClubSettings, Hall } from '@yenisey/types';
import {
  clubSettingsViolations,
  hallViolations,
  isValidTimezone,
  parseClubValues,
  parseSocialUrl,
  readClubValues,
  type HallRulesInput,
} from './settings-rules.ts';

/** Настройки клуба «Енисей» из ТЗ — точка отсчёта для точечных отклонений. */
function settings(overrides: Partial<ClubSettings> = {}): ClubSettings {
  return {
    name: 'АНТ «Енисей»',
    cityId: null,
    phone: null,
    email: null,
    description: null,
    values: [],
    vkUrl: null,
    maxUrl: null,
    bannerFileId: null,
    logoUrl: null,
    accentColor: null,
    noShowChargePercent: 100,
    attendanceReminderAfterMinutes: 60,
    attendanceAutoNoShowAfterMinutes: 1440,
    subscriptionBurnsOnNoShowOnly: true,
    ...overrides,
  };
}

/** Основной зал «Енисея» с ценами из прайса. */
function hall(overrides: Partial<Hall> = {}): HallRulesInput {
  return {
    name: 'Основной зал',
    timezone: 'Asia/Krasnoyarsk',
    cityId: null,
    address: null,
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

  it('часовой пояс настройкам клуба больше не принадлежит', () => {
    // Пояс переехал на зал: залы одной организации бывают в разных регионах.
    // Проверка живёт в hallViolations, и клубу здесь предъявлять нечего.
    assert.equal('timezone' in settings(), false);
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

  it('опечатка в часовом поясе зала отклоняется', () => {
    // Ровно тот случай, ради которого проверка и заведена: строка выглядит
    // правдоподобно и молча сдвинула бы границы суток именно этого зала.
    const violations = hallViolations(hall({ timezone: 'Asia/Krasnayarsk' }));

    assert.equal(violations.length, 1);
    assert.match(violations[0]!, /Часовой пояс/);
  });

  it('нарушения возвращаются все разом, а не по одному', () => {
    const violations = hallViolations(
      hall({ name: '  ', timezone: 'Красноярск', hasRobotOption: true }),
    );

    assert.equal(violations.length, 3);
  });
});

describe('parseClubValues', () => {
  it('пустые пункты отбрасываются, остальное обрезается', () => {
    const result = parseClubValues([{ title: ' Честность ', text: ' Играем по правилам ' }, { title: '', text: '  ' }]);
    assert.deepEqual(result, { ok: true, value: [{ title: 'Честность', text: 'Играем по правилам' }] });
  });

  it('пусто — null: CHECK не примет пустой массив', () => {
    assert.deepEqual(parseClubValues([]), { ok: true, value: null });
  });

  it('текст без заголовка — ошибка, а не молча потерянный текст', () => {
    assert.equal(parseClubValues([{ title: '', text: 'Без заголовка' }]).ok, false);
  });

  it('седьмая ценность — ошибка', () => {
    const seven = Array.from({ length: 7 }, (_, index) => ({ title: `Пункт ${index}`, text: '' }));
    assert.equal(parseClubValues(seven).ok, false);
  });

  it('слишком длинный заголовок', () => {
    assert.equal(parseClubValues([{ title: 'я'.repeat(61), text: '' }]).ok, false);
  });
});

describe('readClubValues', () => {
  it('негодное из базы отбрасывается', () => {
    assert.deepEqual(readClubValues([{ title: 'Семья', text: '' }, { title: 1 }, 'строка', null]), [{ title: 'Семья', text: '' }]);
    assert.deepEqual(readClubValues({ title: 'не массив' }), []);
    assert.deepEqual(readClubValues(null), []);
  });
});

describe('parseSocialUrl', () => {
  it('без схемы — дописывается https', () => {
    assert.deepEqual(parseSocialUrl('vk', 'vk.com/yenisey_tt'), { ok: true, value: 'https://vk.com/yenisey_tt' });
  });

  it('www, мобильная версия и косая черта в конце нормализуются', () => {
    assert.deepEqual(parseSocialUrl('vk', 'https://m.vk.com/club123/'), { ok: true, value: 'https://vk.com/club123' });
    assert.deepEqual(parseSocialUrl('vk', 'http://www.vk.ru/yenisey'), { ok: true, value: 'https://vk.ru/yenisey' });
  });

  it('MAX — ссылка на канал', () => {
    assert.deepEqual(parseSocialUrl('max', 'https://max.ru/join/AbC-123'), { ok: true, value: 'https://max.ru/join/AbC-123' });
  });

  it('javascript: и чужой домен — отказ', () => {
    assert.equal(parseSocialUrl('vk', 'javascript:alert(1)').ok, false);
    assert.equal(parseSocialUrl('vk', 'https://vk.com.evil.ru/x').ok, false);
    assert.equal(parseSocialUrl('max', 'https://vk.com/yenisey').ok, false);
  });

  it('главная без страницы клуба — отказ', () => {
    assert.equal(parseSocialUrl('vk', 'https://vk.com/').ok, false);
  });

  it('пусто — убрать ссылку', () => {
    assert.deepEqual(parseSocialUrl('max', '  '), { ok: true, value: null });
    assert.deepEqual(parseSocialUrl('max', null), { ok: true, value: null });
  });
});
