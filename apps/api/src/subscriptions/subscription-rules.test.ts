import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  consumed,
  decideAdjustment,
  decideClose,
  decideLedger,
  decideMove,
  decidePlanCoverage,
  expiryOf,
  isActive,
  pickSubscription,
  subscriptionCancelRatio,
  usable,
  type SubscriptionFacts,
} from './subscription-rules.ts';

const KRSK = 'Asia/Krasnoyarsk';
const at = (value: string) => new Date(value);

const sub = (over: Partial<SubscriptionFacts> = {}): SubscriptionFacts => ({
  id: 's1',
  remainingVisits: 5,
  expiresAt: at('2026-10-01T00:00:00+07:00'),
  trainingTypeIds: ['group'],
  tournamentTypeIds: ['club50'],
  ...over,
});

const training = { kind: 'TRAINING' as const, typeId: 'group', startsAt: at('2026-09-20T18:00:00+07:00') };

describe('usable', () => {
  it('покрытый тип в сроке и с визитами — годится', () => {
    assert.equal(usable(sub(), training), true);
  });

  it('тип не покрыт — не годится, и турнир отличается от тренировки', () => {
    assert.equal(usable(sub(), { ...training, typeId: 'kids' }), false);
    assert.equal(usable(sub(), { ...training, kind: 'TOURNAMENT', typeId: 'group' }), false);
    assert.equal(usable(sub(), { ...training, kind: 'TOURNAMENT', typeId: 'club50' }), true);
  });

  it('срок сверяется с началом мероприятия, а не с моментом записи', () => {
    const expiring = sub({ expiresAt: at('2026-09-20T00:00:00+07:00') });

    assert.equal(usable(expiring, training), false);
    assert.equal(usable(expiring, { ...training, startsAt: at('2026-09-19T23:59:00+07:00') }), true);
  });

  it('пустой абонемент не годится, безлимит — всегда', () => {
    assert.equal(usable(sub({ remainingVisits: 0 }), training), false);
    assert.equal(usable(sub({ remainingVisits: null }), training), true);
  });
});

describe('pickSubscription', () => {
  it('платит раньше истекающий, бессрочный — последним', () => {
    const late = sub({ id: 'late', expiresAt: at('2026-12-01T00:00:00+07:00') });
    const soon = sub({ id: 'soon', expiresAt: at('2026-10-01T00:00:00+07:00') });
    const forever = sub({ id: 'forever', expiresAt: null });

    assert.equal(pickSubscription([forever, late, soon], training)?.id, 'soon');
    assert.equal(pickSubscription([forever, late], training)?.id, 'late');
  });

  it('при равном сроке — где визитов меньше; безлимит — после всех', () => {
    const many = sub({ id: 'many', remainingVisits: 9 });
    const few = sub({ id: 'few', remainingVisits: 1 });
    const unlimited = sub({ id: 'unlimited', remainingVisits: null });

    assert.equal(pickSubscription([unlimited, many, few], training)?.id, 'few');
  });

  it('при полном равенстве выбор не зависит от порядка строк', () => {
    const a = sub({ id: 'a' });
    const b = sub({ id: 'b' });

    assert.equal(pickSubscription([b, a], training)?.id, 'a');
    assert.equal(pickSubscription([a, b], training)?.id, 'a');
  });

  it('нет подходящего — null, и запись идёт по цене', () => {
    assert.equal(pickSubscription([sub({ remainingVisits: 0 })], training), null);
  });
});

describe('consumed и decideLedger', () => {
  it('записан и пришёл — визит израсходован', () => {
    assert.equal(consumed({ status: 'BOOKED', chargeRatio: null }), true);
    assert.equal(consumed({ status: 'ATTENDED', chargeRatio: 100 }), true);
  });

  it('отмена и неявка — по проценту: 100 сгорел, 0 вернулся', () => {
    assert.equal(consumed({ status: 'CANCELLED', chargeRatio: 0 }), false);
    assert.equal(consumed({ status: 'CANCELLED', chargeRatio: 100 }), true);
    assert.equal(consumed({ status: 'NO_SHOW', chargeRatio: 100 }), true);
    assert.equal(consumed({ status: 'NO_SHOW', chargeRatio: 0 }), false);
  });

  it('неявка после записи журнала не трогает — визит уже списан', () => {
    const booked = consumed({ status: 'BOOKED', chargeRatio: null });
    const noShow = consumed({ status: 'NO_SHOW', chargeRatio: 100 });

    assert.equal(decideLedger(booked, noShow), null);
  });

  it('прощённая неявка возвращает визит, снятое прощение — списывает снова', () => {
    const noShow = consumed({ status: 'NO_SHOW', chargeRatio: 100 });
    const waived = consumed({ status: 'NO_SHOW', chargeRatio: 0 });

    assert.equal(decideLedger(noShow, waived), 1);
    assert.equal(decideLedger(waived, noShow), -1);
  });

  it('неявка, исправленная на «пришёл», журнал не трогает', () => {
    assert.equal(
      decideLedger(consumed({ status: 'NO_SHOW', chargeRatio: 100 }), consumed({ status: 'ATTENDED', chargeRatio: 100 })),
      null,
    );
  });
});

describe('decideMove', () => {
  it('у безлимита движение нулевое, остатка нет', () => {
    assert.deepEqual(decideMove(null, -1), { ok: true, delta: 0, balanceAfter: null });
  });

  it('списание с пустого абонемента — 409', () => {
    const decision = decideMove(0, -1);

    assert.equal(decision.ok, false);
    assert.equal((decision as { status: number }).status, 409);
  });

  it('обычные списание и возврат', () => {
    assert.deepEqual(decideMove(3, -1), { ok: true, delta: -1, balanceAfter: 2 });
    assert.deepEqual(decideMove(0, 1), { ok: true, delta: 1, balanceAfter: 1 });
  });
});

describe('subscriptionCancelRatio', () => {
  it('мягкое правило возвращает визит при любой отмене', () => {
    assert.equal(subscriptionCancelRatio(true, 100), 0);
    assert.equal(subscriptionCancelRatio(true, 50), 0);
  });

  it('строгое сжигает визит целиком при любом ненулевом проценте', () => {
    assert.equal(subscriptionCancelRatio(false, 50), 100);
    assert.equal(subscriptionCancelRatio(false, 0), 0);
  });
});

describe('expiryOf', () => {
  it('30 дней с 5 марта — по 3 апреля включительно, до полуночи по часам клуба', () => {
    const purchased = at('2026-03-05T15:00:00+07:00');

    assert.equal(expiryOf(purchased, 30, KRSK)?.toISOString(), at('2026-04-04T00:00:00+07:00').toISOString());
  });

  it('покупка поздно вечером по UTC считается по местной дате', () => {
    // 23:30 UTC 4 марта — это уже 5 марта в Красноярске.
    const purchased = at('2026-03-04T23:30:00Z');

    assert.equal(expiryOf(purchased, 1, KRSK)?.toISOString(), at('2026-03-06T00:00:00+07:00').toISOString());
  });

  it('бессрочный — без даты окончания', () => {
    assert.equal(expiryOf(at('2026-03-05T12:00:00Z'), null, KRSK), null);
  });
});

describe('isActive', () => {
  const now = at('2026-09-19T12:00:00+07:00');

  it('в сроке и с визитами — действует', () => {
    assert.equal(isActive(sub(), now), true);
  });

  it('истёк или кончились визиты — нет', () => {
    assert.equal(isActive(sub({ expiresAt: at('2026-09-19T00:00:00+07:00') }), now), false);
    assert.equal(isActive(sub({ remainingVisits: 0 }), now), false);
  });
});

describe('decideAdjustment', () => {
  it('без причины не проходит', () => {
    assert.equal(decideAdjustment(sub(), -1, null).ok, false);
  });

  it('ниже нуля не уходит', () => {
    assert.equal(decideAdjustment(sub({ remainingVisits: 2 }), -3, 'Возврат').ok, false);
  });

  it('до нуля — можно: так оформляется возврат абонемента', () => {
    assert.deepEqual(decideAdjustment(sub({ remainingVisits: 2 }), -2, 'Возврат'), {
      ok: true,
      delta: -2,
      balanceAfter: 0,
    });
  });

  it('безлимит по визитам не корректируется, ноль и дробь — тоже', () => {
    assert.equal(decideAdjustment(sub({ remainingVisits: null }), 1, 'Подарок').ok, false);
    assert.equal(decideAdjustment(sub(), 0, 'Ничего').ok, false);
    assert.equal(decideAdjustment(sub(), 1.5, 'Полвизита').ok, false);
  });
});

describe('decideClose', () => {
  const now = at('2026-09-19T12:00:00+07:00');

  it('закрывается только безлимит и только с причиной', () => {
    assert.equal(decideClose(sub({ remainingVisits: null }), null, now).ok, false);
    assert.equal(decideClose(sub({ remainingVisits: 5 }), 'Возврат', now).ok, false);
    assert.deepEqual(decideClose(sub({ remainingVisits: null }), 'Возврат', now), { ok: true, expiresAt: now });
  });

  it('истёкший закрывать незачем', () => {
    const expired = sub({ remainingVisits: null, expiresAt: at('2026-09-01T00:00:00+07:00') });

    assert.equal(decideClose(expired, 'Возврат', now).ok, false);
  });
});

describe('decidePlanCoverage', () => {
  const current = { trainingTypeIds: ['group'], tournamentTypeIds: ['club50'] };

  it('добавлять услуги можно всегда', () => {
    assert.equal(
      decidePlanCoverage(current, { trainingTypeIds: ['group', 'kids'], tournamentTypeIds: ['club50'] }, 3).ok,
      true,
    );
  });

  it('убирать — только пока нет действующих абонементов', () => {
    const next = { trainingTypeIds: ['group'], tournamentTypeIds: [] };

    assert.equal(decidePlanCoverage(current, next, 1).ok, false);
    assert.equal(decidePlanCoverage(current, next, 0).ok, true);
  });

  it('тариф без единой услуги не имеет смысла', () => {
    assert.equal(decidePlanCoverage(current, { trainingTypeIds: [], tournamentTypeIds: [] }, 0).ok, false);
  });
});
