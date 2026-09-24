import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { instantAt, localParts } from '../club/closures.ts';
import {
  afterFailure,
  availableCategories,
  categoryEnabled,
  clientRecipients,
  isToggleableCategory,
  MAX_ATTEMPTS,
  morningDue,
  reminderAt,
  reminderDue,
  retryDelay,
  sendAfterFor,
  type LocalClock,
} from './notification-rules.ts';

/** Часы Красноярска (UTC+7) — те же функции, что у сервиса. */
const krasnoyarsk: LocalClock = {
  local: (instant) => localParts(instant, 'Asia/Krasnoyarsk'),
  instant: (date, minute) => instantAt(date, minute, 'Asia/Krasnoyarsk'),
};

/** Местное время Красноярска → мгновение. */
const kr = (local: string) => new Date(`${local}+07:00`);

describe('sendAfterFor: тихие часы', () => {
  it('днём — сразу', () => {
    assert.equal(sendAfterFor(kr('2026-09-23T14:00:00'), krasnoyarsk, false), undefined);
  });

  it('в 23:30 — в 08:00 следующего утра', () => {
    assert.deepEqual(sendAfterFor(kr('2026-09-23T23:30:00'), krasnoyarsk, false), kr('2026-09-24T08:00:00'));
  });

  it('в 06:10 — в 08:00 того же утра', () => {
    assert.deepEqual(sendAfterFor(kr('2026-09-24T06:10:00'), krasnoyarsk, false), kr('2026-09-24T08:00:00'));
  });

  it('границы: 22:00 уже тихо, 08:00 уже нет', () => {
    assert.ok(sendAfterFor(kr('2026-09-23T22:00:00'), krasnoyarsk, false));
    assert.equal(sendAfterFor(kr('2026-09-24T08:00:00'), krasnoyarsk, false), undefined);
  });

  it('собственное действие ночью — сразу: человек сам сейчас не спит', () => {
    assert.equal(sendAfterFor(kr('2026-09-23T23:30:00'), krasnoyarsk, true), undefined);
  });

  it('пояс — зала: в Москве 18:30 — ещё день, хотя в Красноярске уже тихо', () => {
    const moscow: LocalClock = {
      local: (instant) => localParts(instant, 'Europe/Moscow'),
      instant: (date, minute) => instantAt(date, minute, 'Europe/Moscow'),
    };

    assert.equal(sendAfterFor(new Date('2026-09-23T18:30:00+03:00'), moscow, false), undefined);
    assert.ok(sendAfterFor(new Date('2026-09-23T18:30:00+03:00'), krasnoyarsk, false));
  });
});

describe('reminderAt', () => {
  it('за три часа до начала', () => {
    assert.deepEqual(reminderAt(kr('2026-09-24T18:00:00'), krasnoyarsk), kr('2026-09-24T15:00:00'));
  });

  it('занятие в 11:00 — напоминание ровно в 08:00', () => {
    assert.deepEqual(reminderAt(kr('2026-09-24T11:00:00'), krasnoyarsk), kr('2026-09-24T08:00:00'));
  });

  it('занятие в 10:00 — напоминание уезжает на 20:00 накануне', () => {
    assert.deepEqual(reminderAt(kr('2026-09-24T10:00:00'), krasnoyarsk), kr('2026-09-23T20:00:00'));
  });

  it('занятие в 06:00 — тоже накануне в 20:00', () => {
    assert.deepEqual(reminderAt(kr('2026-09-24T06:00:00'), krasnoyarsk), kr('2026-09-23T20:00:00'));
  });
});

describe('reminderDue', () => {
  const startsAt = kr('2026-09-24T18:00:00');
  const due = kr('2026-09-24T15:00:00');
  const createdAt = kr('2026-09-20T12:00:00');

  it('рано — нет, в срок — да', () => {
    assert.equal(reminderDue({ createdAt, startsAt }, due, kr('2026-09-24T14:59:00')), false);
    assert.equal(reminderDue({ createdAt, startsAt }, due, kr('2026-09-24T15:00:00')), true);
  });

  it('записался уже после момента напоминания — не напоминаем: только что пришло подтверждение', () => {
    assert.equal(reminderDue({ createdAt: kr('2026-09-24T16:00:00'), startsAt }, due, kr('2026-09-24T16:01:00')), false);
  });

  it('опоздание больше двух часов — уже не шлём', () => {
    assert.equal(reminderDue({ createdAt, startsAt }, due, kr('2026-09-24T17:01:00')), false);
  });

  it('после начала — не шлём', () => {
    assert.equal(reminderDue({ createdAt, startsAt: kr('2026-09-24T16:00:00') }, kr('2026-09-24T13:00:00'), kr('2026-09-24T16:00:00')), false);
  });
});

describe('clientRecipients', () => {
  const child = new Date('2014-05-01T00:00:00Z');
  const rights = (link: { status: string }) => link.status === 'ACTIVE';

  it('сам клиент — всегда', () => {
    assert.deepEqual(clientRecipients('kid', [], rights), ['kid']);
  });

  it('родитель с правами — тоже, без прав — нет', () => {
    assert.deepEqual(
      clientRecipients(
        'kid',
        [
          { guardianUserId: 'mom', status: 'ACTIVE', childBirthDate: child },
          { guardianUserId: 'stranger', status: 'REVOKED', childBirthDate: child },
        ],
        rights,
      ),
      ['kid', 'mom'],
    );
  });
});

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

  it('сказано, сколько ждать, — ждём столько', () => {
    const decision = afterFailure(1, now, 7_000);

    assert.deepEqual(decision, { status: 'PENDING', sendAfter: new Date('2026-09-23T10:00:07Z') });
  });

  it(`после ${MAX_ATTEMPTS} попыток строка неудачная`, () => {
    assert.equal(afterFailure(MAX_ATTEMPTS - 1, now).status, 'PENDING');
    assert.equal(afterFailure(MAX_ATTEMPTS, now).status, 'FAILED');
  });
});

describe('morningDue: утренние сообщения', () => {
  it('с 08:00 до полудня — за сегодняшнюю местную дату', () => {
    assert.equal(morningDue(kr('2026-09-24T07:59:00'), krasnoyarsk), null);
    assert.equal(morningDue(kr('2026-09-24T08:00:00'), krasnoyarsk), '2026-09-24');
    assert.equal(morningDue(kr('2026-09-24T11:59:00'), krasnoyarsk), '2026-09-24');
  });

  it('после полудня — уже нет: план на день к обеду не план', () => {
    assert.equal(morningDue(kr('2026-09-24T12:00:00'), krasnoyarsk), null);
  });

  it('дата — местная: в Красноярске уже утро 24-го, по UTC ещё 24-е 01:00', () => {
    assert.equal(morningDue(new Date('2026-09-24T01:00:00Z'), krasnoyarsk), '2026-09-24');
  });
});
