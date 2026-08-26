import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  offsetMinutes,
  RUSSIAN_TIMEZONES,
  timezoneOptions,
  zonedToInstant,
  zoneOffset,
} from './timezones.ts';

describe('zoneOffset', () => {
  it('показывает смещение ровным часом', () => {
    assert.equal(zoneOffset('Asia/Krasnoyarsk'), 'UTC+7');
    assert.equal(zoneOffset('Europe/Moscow'), 'UTC+3');
    assert.equal(zoneOffset('Europe/Kaliningrad'), 'UTC+2');
  });

  it('UTC показывает нулевым смещением', () => {
    assert.equal(zoneOffset('UTC'), 'UTC+0');
  });

  it('на неизвестной зоне возвращает пустую строку, а не падает', () => {
    // Подпись пропадёт, но форма останется рабочей: чинить часовой пояс
    // человеку придётся и без неё.
    assert.equal(zoneOffset('Asia/Krasnayarsk'), '');
  });
});

describe('timezoneOptions', () => {
  it('перечисляет все зоны России', () => {
    assert.equal(timezoneOptions('Asia/Krasnoyarsk').length, RUSSIAN_TIMEZONES.length);
  });

  it('подпись содержит и город, и смещение', () => {
    const option = timezoneOptions('Asia/Krasnoyarsk').find(
      (item) => item.value === 'Asia/Krasnoyarsk',
    );

    assert.match(option?.label ?? '', /Красноярск/);
    assert.match(option?.label ?? '', /UTC\+7/);
  });

  it('чужая зона добавляется вариантом, а не подменяется ближайшей', () => {
    // Молча переписать клубу часовой пояс — значит сдвинуть ему все пороги
    // отмены, поэтому записанное значение обязано остаться выбираемым.
    const options = timezoneOptions('Asia/Tokyo');

    assert.equal(options.length, RUSSIAN_TIMEZONES.length + 1);
    assert.equal(options[0]?.value, 'Asia/Tokyo');
    assert.match(options[0]?.label ?? '', /UTC\+9/);
  });

  it('зоны в списке не повторяются', () => {
    const ids = RUSSIAN_TIMEZONES.map((zone) => zone.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('offsetMinutes', () => {
  it('Красноярск — семь часов впереди UTC', () => {
    assert.equal(offsetMinutes(new Date('2026-03-10T00:00:00Z'), 'Asia/Krasnoyarsk'), 420);
  });

  it('Калининград — два часа', () => {
    assert.equal(offsetMinutes(new Date('2026-03-10T00:00:00Z'), 'Europe/Kaliningrad'), 120);
  });

  it('UTC — ноль', () => {
    assert.equal(offsetMinutes(new Date('2026-03-10T00:00:00Z'), 'UTC'), 0);
  });
});

describe('zonedToInstant', () => {
  it('время клуба переводится в мгновение UTC', () => {
    // 15:00 в Красноярске (UTC+7) — это 08:00 UTC.
    const instant = zonedToInstant('2026-03-12', '15:00', 'Asia/Krasnoyarsk');

    assert.equal(instant?.toISOString(), '2026-03-12T08:00:00.000Z');
  });

  it('пояс клуба, а не браузера, решает результат', () => {
    // Одни и те же цифры в разных клубах — разные мгновения.
    const krsk = zonedToInstant('2026-03-12', '15:00', 'Asia/Krasnoyarsk');
    const msk = zonedToInstant('2026-03-12', '15:00', 'Europe/Moscow');

    assert.notEqual(krsk?.toISOString(), msk?.toISOString());
    assert.equal(msk?.toISOString(), '2026-03-12T12:00:00.000Z');
  });

  it('раннее утро уезжает на предыдущие сутки UTC', () => {
    // 06:00 в Красноярске — это 23:00 прошлого дня по UTC.
    const instant = zonedToInstant('2026-03-12', '06:00', 'Asia/Krasnoyarsk');

    assert.equal(instant?.toISOString(), '2026-03-11T23:00:00.000Z');
  });

  it('на мусоре возвращает null, а не Invalid Date', () => {
    assert.equal(zonedToInstant('', '15:00', 'Asia/Krasnoyarsk'), null);
    assert.equal(zonedToInstant('2026-03-12', '', 'Asia/Krasnoyarsk'), null);
  });
});
