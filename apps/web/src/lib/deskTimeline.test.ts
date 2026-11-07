import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DeskBooking, DeskEvent } from '@yenisey/types';
import { deskTimeline } from './deskTimeline.ts';

const booking = (id: string, startsAt: string, status: DeskBooking['status'] = 'BOOKED'): DeskBooking => ({
  id,
  startsAt,
  status,
  endsAt: '2026-11-07T12:00:00Z',
  phase: 'ONGOING',
  tableId: 'table',
  tableLabel: 'Стол 1',
  hallId: 'hall',
  hallName: 'Зал',
  withRobot: false,
  price: 40000,
  client: {
    userId: 'person',
    fullName: 'Тестовый Игрок',
    phone: '+70000000000',
  },
  manual: false,
  sparring: false,
  sparringType: null,
  coachName: null,
  bySubscription: false,
  createdBy: null,
  cancelledAt: null,
  chargePercent: null,
  autoNoShowAt: null,
  mark: null,
});
const event = (id: string, startsAt: string, kind: DeskEvent['kind'] = 'TRAINING'): DeskEvent => ({
  id,
  startsAt,
  kind,
  endsAt: '2026-11-07T13:00:00Z',
  title: 'Группа',
  price: 70000,
  capacity: 8,
  coachName: 'Тестовый Тренер',
  participants: [],
  phase: 'UPCOMING',
  autoNoShowAt: null,
});

describe('deskTimeline', () => {
  it('сводит аренды и мероприятия по моменту начала, сохраняя серверные фазы', () => {
    const bookings = [booking('late', '2026-11-07T16:00:00+07:00', 'ATTENDED')];
    const events = [event('early', '2026-11-07T08:00:00Z')];
    const unplaced = [event('middle', '2026-11-07T08:30:00Z', 'TOURNAMENT')];
    const rows = deskTimeline({ bookings, events, unplaced });

    assert.deepEqual(
      rows.map((row) => row.key),
      ['TRAINING:early', 'TOURNAMENT:middle', 'TABLE:late'],
    );
    assert.equal(rows[2]!.booking?.status, 'ATTENDED');
    assert.equal(rows[2]!.booking?.phase, 'ONGOING');
    assert.equal(rows[1]!.unplaced, true);
    assert.equal(bookings[0]!.id, 'late');
  });

  it('убирает отменённую аренду, но сохраняет прошедшую и мероприятие без участников', () => {
    const rows = deskTimeline({
      bookings: [
        booking('cancelled', '2026-11-07T08:00:00Z', 'CANCELLED'),
        booking('past', '2026-11-07T07:00:00Z', 'NO_SHOW'),
      ],
      events: [event('empty', '2026-11-07T09:00:00Z')],
      unplaced: [],
    });
    assert.deepEqual(
      rows.map((row) => row.key),
      ['TABLE:past', 'TRAINING:empty'],
    );
  });

  it('различает одинаковые id занятия и турнира и не дублирует мероприятие из двух списков', () => {
    const group = event('same', '2026-11-07T09:00:00Z');
    const rows = deskTimeline({
      bookings: [],
      events: [group],
      unplaced: [group, event('same', group.startsAt, 'TOURNAMENT')],
    });
    assert.equal(rows.length, 2);
    assert.deepEqual(new Set(rows.map((row) => row.key)), new Set(['TRAINING:same', 'TOURNAMENT:same']));
    assert.equal(rows.find((row) => row.key === 'TRAINING:same')!.unplaced, false);
  });
});
