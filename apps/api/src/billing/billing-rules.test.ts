import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addMonths, billingStep, graceUntil, monthlyActs, paidPeriod, type SubscriptionState } from './billing-rules.ts';

const at = (iso: string): Date => new Date(iso);
const DAY = 24 * 60 * 60 * 1000;

const base: SubscriptionState = {
  status: 'ACTIVE',
  trialEndsAt: null,
  paidUntil: at('2026-11-02T00:00:00Z'),
  autoRenew: true,
  hasCard: true,
  pastDueSince: null,
  chargeAttempts: 0,
  lastChargeAttemptAt: null,
};

describe('billingStep', () => {
  it('пилотный клуб и приостановленный — ничего', () => {
    assert.deepEqual(billingStep({ ...base, status: 'EXEMPT', paidUntil: null }, at('2030-01-01T00:00:00Z')), { kind: 'none' });
    assert.deepEqual(billingStep({ ...base, status: 'SUSPENDED' }, at('2030-01-01T00:00:00Z')), { kind: 'none' });
  });

  it('за 7 дней и за 1 день до конца — напоминание, раньше — ничего', () => {
    assert.deepEqual(billingStep(base, at('2026-10-20T00:00:00Z')), { kind: 'none' });
    assert.deepEqual(billingStep(base, at('2026-10-26T00:00:00Z')), { kind: 'remind', days: 7, endsAt: base.paidUntil });
    assert.deepEqual(billingStep(base, at('2026-11-01T12:00:00Z')), { kind: 'remind', days: 1, endsAt: base.paidUntil });
  });

  it('срок вышел, карта и автопродление — списание', () => {
    assert.deepEqual(billingStep(base, at('2026-11-02T00:00:00Z')), { kind: 'charge' });
  });

  it('срок вышел без карты или без автопродления — просрочка с конца срока', () => {
    const since = base.paidUntil!;
    assert.deepEqual(billingStep({ ...base, hasCard: false }, at('2026-11-03T00:00:00Z')), { kind: 'past_due', since });
    assert.deepEqual(billingStep({ ...base, autoRenew: false }, at('2026-11-03T00:00:00Z')), { kind: 'past_due', since });
  });

  it('пробный период картой не продлевается — просрочка с его конца', () => {
    const trial = { ...base, status: 'TRIAL' as const, paidUntil: null, trialEndsAt: at('2026-10-09T00:00:00Z') };
    assert.deepEqual(billingStep(trial, at('2026-10-08T06:00:00Z')), { kind: 'remind', days: 1, endsAt: trial.trialEndsAt });
    assert.deepEqual(billingStep(trial, at('2026-10-09T00:00:01Z')), { kind: 'past_due', since: trial.trialEndsAt });
  });

  it('просрочка: три льготных дня, повтор раз в сутки, потом приостановка', () => {
    const since = at('2026-11-02T00:00:00Z');
    const pastDue = { ...base, status: 'PAST_DUE' as const, pastDueSince: since, lastChargeAttemptAt: since, chargeAttempts: 1 };

    assert.deepEqual(billingStep(pastDue, at('2026-11-02T12:00:00Z')), { kind: 'none' });
    assert.deepEqual(billingStep(pastDue, at('2026-11-03T00:00:00Z')), { kind: 'charge' });
    assert.deepEqual(billingStep({ ...pastDue, hasCard: false }, at('2026-11-03T00:00:00Z')), { kind: 'none' });
    assert.deepEqual(billingStep(pastDue, at('2026-11-05T00:00:00Z')), { kind: 'suspend' });
  });

  it('льгота — ровно три дня', () => {
    assert.equal(graceUntil(at('2026-11-02T00:00:00Z')).getTime() - at('2026-11-02T00:00:00Z').getTime(), 3 * DAY);
  });
});

describe('addMonths', () => {
  it('конец месяца не перескакивает в следующий', () => {
    assert.equal(addMonths(at('2026-01-31T10:00:00Z'), 1).toISOString(), '2026-02-28T10:00:00.000Z');
    assert.equal(addMonths(at('2028-01-31T10:00:00Z'), 1).toISOString(), '2028-02-29T10:00:00.000Z');
    assert.equal(addMonths(at('2026-10-02T10:00:00Z'), 36).toISOString(), '2029-10-02T10:00:00.000Z');
  });
});

describe('paidPeriod', () => {
  const now = at('2026-10-02T10:00:00Z');

  it('активную продлевает с конца оплаченного', () => {
    const period = paidPeriod({ status: 'ACTIVE', paidUntil: at('2026-10-20T00:00:00Z'), trialEndsAt: null }, now, 1);
    assert.equal(period.from.toISOString(), '2026-10-20T00:00:00.000Z');
    assert.equal(period.to.toISOString(), '2026-11-20T00:00:00.000Z');
  });

  it('пробную — с конца пробного: дни не пропадают', () => {
    const period = paidPeriod({ status: 'TRIAL', paidUntil: null, trialEndsAt: at('2026-10-09T10:00:00Z') }, now, 12);
    assert.equal(period.from.toISOString(), '2026-10-09T10:00:00.000Z');
  });

  it('приостановленную и просроченную — с момента оплаты', () => {
    for (const status of ['SUSPENDED', 'PAST_DUE'] as const) {
      const period = paidPeriod({ status, paidUntil: at('2026-09-01T00:00:00Z'), trialEndsAt: null }, now, 1);
      assert.equal(period.from.toISOString(), now.toISOString());
    }
  });
});

describe('monthlyActs', () => {
  it('год — двенадцать актов, сумма до копейки', () => {
    const from = at('2026-10-02T10:00:00Z');
    const acts = monthlyActs(from, addMonths(from, 12), 5_000_000);

    assert.equal(acts.length, 12);
    assert.equal(acts.reduce((sum, act) => sum + act.amount, 0), 5_000_000);
    assert.equal(acts[0]!.amount, 416_666);
    assert.equal(acts[11]!.amount, 5_000_000 - 416_666 * 11);
    assert.equal(acts[1]!.from.toISOString(), '2026-11-02T10:00:00.000Z');
    assert.equal(acts[11]!.to.toISOString(), '2027-10-02T10:00:00.000Z');
  });

  it('месяц — один акт на всю сумму', () => {
    const from = at('2026-10-02T10:00:00Z');
    assert.deepEqual(
      monthlyActs(from, addMonths(from, 1), 500_000).map((act) => act.amount),
      [500_000],
    );
  });
});
