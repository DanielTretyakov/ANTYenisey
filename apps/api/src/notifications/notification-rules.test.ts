import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  afterFailure,
  availableCategories,
  categoryEnabled,
  isToggleableCategory,
  MAX_ATTEMPTS,
  retryDelay,
} from './notification-rules.ts';

describe('availableCategories', () => {
  it('клиенту — только свои записи и абонемент', () => {
    assert.deepEqual(availableCategories({ clubRoles: ['CLIENT'], platformOwner: false }), [
      'MY_BOOKINGS',
      'MY_SUBSCRIPTION',
    ]);
  });

  it('человеку без клубов — то же самое: записаться он может в любой момент', () => {
    assert.deepEqual(availableCategories({ clubRoles: [], platformOwner: false }), [
      'MY_BOOKINGS',
      'MY_SUBSCRIPTION',
    ]);
  });

  it('тренер-администратор в двух клубах получает и группы, и дела клуба', () => {
    assert.deepEqual(availableCategories({ clubRoles: ['COACH', 'ADMIN'], platformOwner: false }), [
      'MY_BOOKINGS',
      'MY_SUBSCRIPTION',
      'COACH_GROUPS',
      'CLUB_ALERTS',
      'CLUB_DIGEST',
    ]);
  });

  it('сводка платформы — только владельцу платформы, клубная роль её не даёт', () => {
    assert.ok(!availableCategories({ clubRoles: ['OWNER'], platformOwner: false }).includes('PLATFORM_DIGEST'));
    assert.ok(availableCategories({ clubRoles: [], platformOwner: true }).includes('PLATFORM_DIGEST'));
  });
});

describe('categoryEnabled', () => {
  it('без настройки категория включена', () => {
    assert.equal(categoryEnabled('MY_BOOKINGS', new Set()), true);
  });

  it('выключенная — выключена', () => {
    assert.equal(categoryEnabled('CLUB_DIGEST', new Set(['CLUB_DIGEST'])), false);
  });

  it('служебное не выключается, даже если строка откуда-то взялась', () => {
    assert.equal(categoryEnabled('SERVICE', new Set(['SERVICE'])), true);
  });

  it('служебную категорию нельзя выбрать в настройках', () => {
    assert.equal(isToggleableCategory('SERVICE'), false);
    assert.equal(isToggleableCategory('MY_BOOKINGS'), true);
    assert.equal(isToggleableCategory('whatever'), false);
  });
});

describe('повторы отправки', () => {
  const now = new Date('2026-09-23T10:00:00Z');

  it('пауза растёт вдвое и упирается в час', () => {
    assert.equal(retryDelay(1), 30_000);
    assert.equal(retryDelay(2), 60_000);
    assert.equal(retryDelay(3), 120_000);
    assert.equal(retryDelay(20), 3_600_000);
  });

  it('Telegram сказал, сколько ждать, — ждём столько', () => {
    const decision = afterFailure(1, now, 7_000);

    assert.deepEqual(decision, { status: 'PENDING', sendAfter: new Date('2026-09-23T10:00:07Z') });
  });

  it(`после ${MAX_ATTEMPTS} попыток строка неудачная`, () => {
    assert.equal(afterFailure(MAX_ATTEMPTS - 1, now).status, 'PENDING');
    assert.equal(afterFailure(MAX_ATTEMPTS, now).status, 'FAILED');
  });
});
