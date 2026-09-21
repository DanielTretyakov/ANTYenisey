import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { personSummary, type SummaryEntry } from './person-summary.ts';

const NOW = new Date('2026-09-12T12:00:00Z');

const entry = (over: Partial<SummaryEntry> = {}): SummaryEntry => ({
  status: 'ATTENDED',
  startsAt: '2026-09-01T10:00:00.000Z',
  charged: 80_000,
  ...over,
});

describe('personSummary', () => {
  it('пустая история — пустая сводка', () => {
    assert.deepEqual(personSummary([], [], NOW), {
      visits: 0,
      noShows: 0,
      cancellations: 0,
      lateCancellations: 0,
      upcoming: 0,
      accrued: 0,
      lastVisitAt: null,
    });
  });

  it('визиты — это пришедшие записи плюс визиты с порога', () => {
    const summary = personSummary(
      [entry(), entry({ status: 'NO_SHOW', charged: 80_000 }), entry({ status: 'BOOKED', charged: 0 })],
      [{ visitedAt: '2026-09-05T09:00:00.000Z' }],
      NOW,
    );

    assert.equal(summary.visits, 2);
    assert.equal(summary.noShows, 1);
  });

  it('поздняя отмена — та, за которую списали', () => {
    const summary = personSummary(
      [
        entry({ status: 'CANCELLED', charged: 0 }),
        entry({ status: 'CANCELLED', charged: 40_000 }),
      ],
      [],
      NOW,
    );

    assert.equal(summary.cancellations, 2);
    assert.equal(summary.lateCancellations, 1);
  });

  it('сгоревший визит — тоже поздняя отмена, хотя денег за ней нет', () => {
    const summary = personSummary(
      [
        entry({ status: 'CANCELLED', charged: 0, burnedVisit: true }),
        entry({ status: 'CANCELLED', charged: 0, burnedVisit: false }),
      ],
      [],
      NOW,
    );

    assert.equal(summary.cancellations, 2);
    assert.equal(summary.lateCancellations, 1);
    assert.equal(summary.accrued, 0, 'абонемент денег не приносит');
  });

  it('начислено складывается по неявкам и отменам тоже', () => {
    const summary = personSummary(
      [
        entry({ charged: 80_000 }),
        entry({ status: 'NO_SHOW', charged: 70_000 }),
        entry({ status: 'CANCELLED', charged: 40_000 }),
      ],
      [],
      NOW,
    );

    assert.equal(summary.accrued, 190_000);
  });

  /**
   * Иначе у человека, который только записался и ещё ни разу не пришёл, в
   * карточке стояла бы сумма, которой клуб не получал.
   */
  it('будущая бронь в начислено не попадает', () => {
    const summary = personSummary(
      [entry({ status: 'BOOKED', startsAt: '2026-09-20T10:00:00.000Z', charged: 80_000 })],
      [],
      NOW,
    );

    assert.equal(summary.accrued, 0);
    assert.equal(summary.upcoming, 1);
  });

  /**
   * Начавшаяся и неотмеченная — не «предстоящая»: она ждёт отметки клуба, и
   * обещать по ней человека в зале нельзя.
   */
  it('предстоящие — только те, что ещё не начались', () => {
    const summary = personSummary(
      [
        entry({ status: 'BOOKED', startsAt: '2026-09-13T10:00:00.000Z', charged: 0 }),
        entry({ status: 'BOOKED', startsAt: '2026-09-11T10:00:00.000Z', charged: 0 }),
      ],
      [],
      NOW,
    );

    assert.equal(summary.upcoming, 1);
  });

  it('последний визит — самый свежий из состоявшихся, считая порог', () => {
    const summary = personSummary(
      [
        entry({ startsAt: '2026-09-01T10:00:00.000Z' }),
        entry({ startsAt: '2026-09-08T10:00:00.000Z' }),
        // Будущая запись в «последний визит» не попадает: отметки у неё нет.
        entry({ status: 'BOOKED', startsAt: '2026-09-20T10:00:00.000Z', charged: 0 }),
      ],
      [{ visitedAt: '2026-09-09T18:00:00.000Z' }],
      NOW,
    );

    assert.equal(summary.lastVisitAt, '2026-09-09T18:00:00.000Z');
  });

  it('неявка последним визитом не считается', () => {
    const summary = personSummary(
      [
        entry({ startsAt: '2026-09-01T10:00:00.000Z' }),
        entry({ status: 'NO_SHOW', startsAt: '2026-09-10T10:00:00.000Z' }),
      ],
      [],
      NOW,
    );

    assert.equal(summary.lastVisitAt, '2026-09-01T10:00:00.000Z');
  });
});
