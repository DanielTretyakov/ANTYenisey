import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { subscriptionAlert, type AlertSubject } from './subscriptionAlert.ts';

const NOW = new Date('2026-09-21T07:00:00Z');

const sub = (over: Partial<AlertSubject> = {}): AlertSubject => ({
  remainingVisits: 20,
  expiresAt: null,
  active: true,
  ...over,
});

/** Абонемент, который кончается через столько-то суток от NOW. */
const inDays = (days: number): string => new Date(NOW.getTime() + days * 86_400_000).toISOString();

describe('subscriptionAlert', () => {
  it('запас не тревожит', () => {
    assert.equal(subscriptionAlert(sub(), NOW), null);
    assert.equal(subscriptionAlert(sub({ remainingVisits: 6, expiresAt: inDays(8) }), NOW), null);
  });

  it('закончившийся молчит: ему уже не «скоро»', () => {
    assert.equal(subscriptionAlert(sub({ remainingVisits: 0, active: false }), NOW), null);
  });

  it('пять визитов — предупреждение, один — последний', () => {
    assert.deepEqual(subscriptionAlert(sub({ remainingVisits: 5 }), NOW), {
      kind: 'visits',
      level: 'soon',
      visits: 5,
    });
    assert.deepEqual(subscriptionAlert(sub({ remainingVisits: 1 }), NOW), {
      kind: 'visits',
      level: 'last',
      visits: 1,
    });
  });

  it('безлимит визитами не кончается', () => {
    assert.equal(subscriptionAlert(sub({ remainingVisits: null }), NOW), null);
  });

  it('семь, три и один день — три ступени', () => {
    assert.deepEqual(subscriptionAlert(sub({ expiresAt: inDays(7) }), NOW), {
      kind: 'days',
      level: 'soon',
      days: 7,
    });
    assert.deepEqual(subscriptionAlert(sub({ expiresAt: inDays(3) }), NOW), {
      kind: 'days',
      level: 'near',
      days: 3,
    });
    assert.deepEqual(subscriptionAlert(sub({ expiresAt: inDays(1) }), NOW), {
      kind: 'days',
      level: 'last',
      days: 1,
    });
  });

  it('остаток меньше суток — это последний день, а не ноль', () => {
    const alert = subscriptionAlert(sub({ expiresAt: new Date(NOW.getTime() + 600_000).toISOString() }), NOW);

    assert.deepEqual(alert, { kind: 'days', level: 'last', days: 1 });
  });

  it('говорит о том, что кончится раньше', () => {
    // Визитов мало, но срок кончается сегодня — говорить надо про срок.
    const alert = subscriptionAlert(sub({ remainingVisits: 4, expiresAt: inDays(1) }), NOW);

    assert.deepEqual(alert, { kind: 'days', level: 'last', days: 1 });

    // А здесь наоборот: неделя в запасе, но визит последний.
    const other = subscriptionAlert(sub({ remainingVisits: 1, expiresAt: inDays(7) }), NOW);

    assert.deepEqual(other, { kind: 'visits', level: 'last', visits: 1 });
  });
});
