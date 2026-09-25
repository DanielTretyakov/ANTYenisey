import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { birthdayOfAge, fullYears } from '@yenisey/types';
import {
  canBeGuardian,
  decideActing,
  decideAnswer,
  decideCreateChild,
  decideRequest,
  decideRevoke,
  guardianHasRights,
  isChild,
  REQUEST_TTL_DAYS,
} from './guardianship-rules.ts';

const day = (value: string) => new Date(`${value}T00:00:00Z`);
const TODAY = new Date('2026-09-17T05:00:00Z');

const ADULT = day('1985-04-02');
const SEVENTEEN = day('2009-01-01');
const CHILD = day('2015-06-01');

describe('fullYears (общий пакет)', () => {
  it('день рождения сегодня — уже исполнилось, завтра — ещё нет', () => {
    assert.equal(fullYears(day('2010-09-17'), TODAY), 16);
    assert.equal(fullYears(day('2010-09-18'), TODAY), 15);
  });

  it('29 февраля: в невисокосный год — с 1 марта', () => {
    const born = day('2008-02-29');
    assert.equal(fullYears(born, day('2024-02-28')), 15);
    assert.equal(fullYears(born, day('2024-02-29')), 16);
    assert.equal(fullYears(born, day('2025-02-28')), 16);
    assert.equal(fullYears(born, day('2023-02-28')), 14);
    assert.equal(fullYears(born, day('2023-03-01')), 15);
  });

  it('день нужного возраста совпадает с тем, как считает fullYears', () => {
    assert.equal(birthdayOfAge(day('2015-06-01'), 16), '2031-06-01');

    // Родившемуся 29.02.2008 семнадцать исполнится в невисокосный 2025 год —
    // 1 марта, и накануне ему ещё шестнадцать.
    const leap = day('2008-02-29');
    const seventeenth = birthdayOfAge(leap, 17);
    assert.equal(seventeenth, '2025-03-01');
    assert.equal(fullYears(leap, day(seventeenth)), 17);
    assert.equal(fullYears(leap, day('2025-02-28')), 16);
  });
});

describe('isChild и canBeGuardian', () => {
  it('в день четырнадцатилетия опека кончается', () => {
    assert.equal(isChild(day('2012-09-17'), TODAY), false);
    assert.equal(isChild(day('2012-09-18'), TODAY), true);
  });

  it('родителем — с восемнадцати', () => {
    assert.equal(canBeGuardian(day('2008-09-17'), TODAY), true);
    assert.equal(canBeGuardian(day('2008-09-18'), TODAY), false);
  });
});

describe('guardianHasRights', () => {
  it('только действующая опека и только до 14', () => {
    assert.equal(guardianHasRights('ACTIVE', CHILD, TODAY), true);
    assert.equal(guardianHasRights('PENDING', CHILD, TODAY), false);
    assert.equal(guardianHasRights('REVOKED', CHILD, TODAY), false);
    assert.equal(guardianHasRights('ACTIVE', day('2012-09-17'), TODAY), false);
  });
});

describe('decideCreateChild', () => {
  it('взрослый заводит ребёнка', () => {
    assert.deepEqual(decideCreateChild({ guardianBirthDate: ADULT, childBirthDate: CHILD, today: TODAY }), {
      ok: true,
    });
  });

  it('семнадцатилетний — нет', () => {
    const result = decideCreateChild({ guardianBirthDate: SEVENTEEN, childBirthDate: CHILD, today: TODAY });
    assert.equal(!result.ok && result.status, 403);
  });

  it('четырнадцатилетнему учётка ребёнка не нужна', () => {
    const result = decideCreateChild({ guardianBirthDate: ADULT, childBirthDate: day('2012-09-17'), today: TODAY });
    assert.equal(!result.ok && result.status, 400);
  });
});

describe('decideRequest', () => {
  const target = { userId: 'kid', birthDate: CHILD, hasActiveGuardian: false, hasPendingFromRequester: false };
  const base = { requesterId: 'adult', requesterBirthDate: ADULT, today: TODAY };

  it('на ребёнка без родителя — заявка заводится', () => {
    assert.deepEqual(decideRequest({ ...base, target }), { ok: true, create: true });
  });

  it('несуществующая почта, взрослый, сам себя, уже закреплён, повтор — снаружи то же «ok», но без заявки', () => {
    const quiet = { ok: true, create: false };
    assert.deepEqual(decideRequest({ ...base, target: null }), quiet);
    assert.deepEqual(decideRequest({ ...base, target: { ...target, birthDate: ADULT } }), quiet);
    assert.deepEqual(decideRequest({ ...base, target: { ...target, userId: 'adult' } }), quiet);
    assert.deepEqual(decideRequest({ ...base, target: { ...target, hasActiveGuardian: true } }), quiet);
    assert.deepEqual(decideRequest({ ...base, target: { ...target, hasPendingFromRequester: true } }), quiet);
  });

  it('семнадцатилетнему отказ — про свой возраст сказать можно', () => {
    const result = decideRequest({ ...base, requesterBirthDate: SEVENTEEN, target });
    assert.equal(!result.ok && result.status, 403);
  });
});

describe('decideAnswer', () => {
  const request = {
    status: 'PENDING' as const,
    childUserId: 'kid',
    guardianBirthDate: ADULT,
    createdAt: new Date(TODAY.getTime() - 24 * 60 * 60 * 1000),
  };
  const base = { request, answererId: 'kid', childBirthDate: CHILD, today: TODAY };

  it('ребёнок подтверждает свою заявку', () => {
    assert.deepEqual(decideAnswer({ ...base, answer: 'CONFIRM' }), { ok: true });
  });

  it('чужую заявку не видно — ни родителю, ни администратору', () => {
    const result = decideAnswer({ ...base, answererId: 'admin', answer: 'CONFIRM' });
    assert.equal(!result.ok && result.status, 404);
  });

  it('на закрытую заявку ответить нельзя', () => {
    const result = decideAnswer({ ...base, request: { ...request, status: 'REJECTED' }, answer: 'CONFIRM' });
    assert.equal(!result.ok && result.status, 409);
  });

  it(`старше ${REQUEST_TTL_DAYS} дней — не подтверждается, но отклоняется`, () => {
    const stale = { ...request, createdAt: new Date(TODAY.getTime() - (REQUEST_TTL_DAYS + 1) * 24 * 60 * 60 * 1000) };
    assert.equal(decideAnswer({ ...base, request: stale, answer: 'CONFIRM' }).ok, false);
    assert.equal(decideAnswer({ ...base, request: stale, answer: 'REJECT' }).ok, true);
  });

  it('ребёнку исполнилось 14, пока заявка ждала', () => {
    const result = decideAnswer({ ...base, childBirthDate: day('2012-09-17'), answer: 'CONFIRM' });
    assert.equal(result.ok, false);
  });
});

describe('decideRevoke', () => {
  it('родитель — без причины', () => {
    assert.deepEqual(decideRevoke({ status: 'ACTIVE', actor: { kind: 'guardian' }, reason: null }), { ok: true });
  });

  it('администратор клуба — только с причиной', () => {
    const bare = decideRevoke({ status: 'ACTIVE', actor: { kind: 'club-admin' }, reason: null });
    assert.equal(!bare.ok && bare.status, 400);
    assert.deepEqual(
      decideRevoke({ status: 'ACTIVE', actor: { kind: 'club-admin' }, reason: 'Родитель потерял учётку' }),
      { ok: true },
    );
  });

  it('ребёнок и посторонний — нет', () => {
    const result = decideRevoke({ status: 'ACTIVE', actor: { kind: 'other' }, reason: 'хочу сам' });
    assert.equal(!result.ok && result.status, 403);
  });

  it('снятое второй раз не снимается', () => {
    const result = decideRevoke({ status: 'REVOKED', actor: { kind: 'guardian' }, reason: null });
    assert.equal(!result.ok && result.status, 409);
  });
});

describe('decideActing', () => {
  const base = { mode: 'write' as const, callerId: 'adult', callerBirthDate: ADULT, today: TODAY };

  it('взрослый действует сам', () => {
    assert.deepEqual(decideActing({ ...base, forId: null, guardianship: null, childBirthDate: null }), {
      ok: true,
      userId: 'adult',
      byGuardian: false,
    });
  });

  it('до 14 сам не записывается — и «за себя» через forId тоже', () => {
    const kid = {
      mode: 'write' as const,
      callerId: 'kid',
      callerBirthDate: CHILD,
      today: TODAY,
      guardianship: null,
      childBirthDate: null,
    };
    assert.equal(decideActing({ ...kid, forId: null }).ok, false);
    assert.equal(decideActing({ ...kid, forId: 'kid' }).ok, false);
  });

  it('смотреть своё ребёнку можно — он отслеживает, куда его записали', () => {
    assert.deepEqual(
      decideActing({
        mode: 'read',
        callerId: 'kid',
        callerBirthDate: CHILD,
        forId: null,
        guardianship: null,
        childBirthDate: null,
        today: TODAY,
      }),
      { ok: true, userId: 'kid', byGuardian: false },
    );
  });

  it('смотреть чужое — так же нельзя, как менять', () => {
    assert.equal(
      decideActing({ ...base, mode: 'read', forId: 'kid', guardianship: null, childBirthDate: CHILD }).ok,
      false,
    );
  });

  it('родитель — за своего ребёнка младше 14', () => {
    assert.deepEqual(
      decideActing({ ...base, forId: 'kid', guardianship: { status: 'ACTIVE' }, childBirthDate: CHILD }),
      { ok: true, userId: 'kid', byGuardian: true },
    );
  });

  it('за чужого, по заявке без ответа и за четырнадцатилетнего — нет', () => {
    assert.equal(decideActing({ ...base, forId: 'kid', guardianship: null, childBirthDate: CHILD }).ok, false);
    assert.equal(
      decideActing({ ...base, forId: 'kid', guardianship: { status: 'PENDING' }, childBirthDate: CHILD }).ok,
      false,
    );
    assert.equal(
      decideActing({ ...base, forId: 'kid', guardianship: { status: 'ACTIVE' }, childBirthDate: day('2010-09-17') })
        .ok,
      false,
    );
  });
});
