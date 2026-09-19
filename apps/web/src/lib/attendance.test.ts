import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DeskBooking, DeskDay, DeskEvent, DeskParticipant } from '@yenisey/types';
import { correctionsFor, markedRows, markLabel, pendingCounts } from './attendance.ts';

const person = { userId: 'u1', fullName: 'Иванов Иван', phone: '+79990000001' };

const booking = (over: Partial<DeskBooking> = {}): DeskBooking => ({
  id: 'b1',
  tableId: 't1',
  tableLabel: 'Стол 1',
  hallId: 'h1',
  hallName: 'Пироги',
  startsAt: '2026-09-12T10:00:00.000Z',
  endsAt: '2026-09-12T11:00:00.000Z',
  withRobot: false,
  price: 80_000,
  status: 'BOOKED',
  client: person,
  manual: false,
  sparring: false,
  createdBy: null,
  cancelledAt: null,
  chargePercent: null,
  phase: 'AWAITING',
  autoNoShowAt: null,
  mark: null,
  ...over,
});

const participant = (over: Partial<DeskParticipant> = {}): DeskParticipant => ({
  ...person,
  entryId: 'e1',
  status: 'BOOKED',
  chargePercent: null,
  bySubscription: false,
  mark: null,
  ...over,
});

const event = (over: Partial<DeskEvent> = {}): DeskEvent => ({
  id: 's1',
  kind: 'TRAINING',
  title: 'Общая групповая',
  startsAt: '2026-09-12T12:00:00.000Z',
  endsAt: '2026-09-12T13:30:00.000Z',
  price: 70_000,
  capacity: 10,
  coachName: 'Тренеров Тренер',
  participants: [],
  phase: 'ONGOING',
  autoNoShowAt: null,
  ...over,
});

describe('pendingCounts', () => {
  it('считает брони и только неотмеченных участников', () => {
    const pending: DeskDay['pending'] = {
      bookings: [booking(), booking({ id: 'b2', phase: 'OVERDUE' })],
      events: [
        event({
          phase: 'OVERDUE',
          participants: [
            participant(),
            participant({ entryId: 'e2' }),
            participant({ entryId: 'e3', status: 'ATTENDED', chargePercent: 100 }),
          ],
        }),
      ],
    };

    assert.deepEqual(pendingCounts(pending), { total: 4, overdue: 3 });
  });

  it('пустой список — ноль и ноль', () => {
    assert.deepEqual(pendingCounts({ bookings: [], events: [] }), { total: 0, overdue: 0 });
  });
});

describe('markLabel', () => {
  it('различает неявку со списанием и прощённую', () => {
    assert.equal(markLabel('ATTENDED', 100), 'пришёл');
    assert.equal(markLabel('NO_SHOW', 70), 'неявка, списано 70%');
    assert.equal(markLabel('NO_SHOW', 0), 'неявка без списания');
  });

  it('неявка без процента — полная, как и считают деньги', () => {
    assert.equal(markLabel('NO_SHOW', null), 'неявка, списано 100%');
  });
});

describe('correctionsFor', () => {
  const keys = (list: ReturnType<typeof correctionsFor>) => list.map((item) => item.key);

  it('у пришедшего — неявка со списанием или без', () => {
    assert.deepEqual(keys(correctionsFor('ATTENDED', 100, 100)), ['NO_SHOW', 'WAIVE']);
  });

  it('у неявки со списанием — пришёл или простить', () => {
    assert.deepEqual(keys(correctionsFor('NO_SHOW', 100, 100)), ['ATTENDED', 'WAIVE']);
  });

  /** «Простить прощённое» ничего не меняет — такой кнопки быть не должно. */
  it('у прощённой неявки — пришёл или всё-таки списать', () => {
    assert.deepEqual(keys(correctionsFor('NO_SHOW', 0, 100)), ['ATTENDED', 'NO_SHOW']);
  });

  it('процент в подписи — нынешний процент клуба', () => {
    assert.match(correctionsFor('ATTENDED', 100, 70)[0]!.label, /70%/);
  });

  it('у неотмеченной и отменённой исправлять нечего', () => {
    assert.deepEqual(correctionsFor('BOOKED', null, 100), []);
    assert.deepEqual(correctionsFor('CANCELLED', 50, 100), []);
  });
});

describe('markedRows', () => {
  it('собирает отмеченные брони и участников по времени, без неотмеченных', () => {
    const rows = markedRows({
      bookings: [
        booking({ id: 'late', startsAt: '2026-09-12T15:00:00.000Z', status: 'NO_SHOW', chargePercent: 100 }),
        booking({ id: 'waiting' }),
        booking({ id: 'gone', status: 'CANCELLED', chargePercent: 50 }),
      ],
      events: [
        event({
          participants: [
            participant({ entryId: 'came', status: 'ATTENDED', chargePercent: 100 }),
            participant({ entryId: 'pending' }),
          ],
        }),
      ],
    });

    assert.deepEqual(
      rows.map((row) => [row.kind, row.entryId]),
      [
        ['TRAINING', 'came'],
        ['TABLE', 'late'],
      ],
    );
  });

  it('у брони подпись — вид и стол', () => {
    const [row] = markedRows({
      bookings: [booking({ status: 'ATTENDED', chargePercent: 100, withRobot: true })],
      events: [],
    });

    assert.equal(row?.what, 'робот · Стол 1');
  });
});
