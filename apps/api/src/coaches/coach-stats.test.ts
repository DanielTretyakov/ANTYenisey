import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coachStats, periodStart, type StatsSession } from './coach-stats.ts';

const NOW = new Date('2026-09-19T12:00:00Z');

const daysAgo = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const session = (over: Partial<StatsSession> = {}): StatsSession => ({
  endsAt: daysAgo(1),
  capacity: 10,
  entries: [],
  ...over,
});

describe('periodStart', () => {
  it('«всё время» границы не имеет', () => {
    assert.equal(periodStart(0, NOW), null);
  });

  it('срок отсчитывается назад от сегодня', () => {
    assert.equal(periodStart(30, NOW)?.toISOString(), '2026-08-20T12:00:00.000Z');
  });
});

describe('coachStats', () => {
  it('идущее занятие не считается — отметок по нему ещё нет', () => {
    const stats = coachStats(
      [session({ endsAt: new Date(NOW.getTime() + 3_600_000).toISOString(), entries: ['BOOKED'] })],
      0,
      NOW,
    );

    assert.equal(stats.sessions, 0);
    assert.equal(stats.entries, 0);
  });

  it('за пределами срока занятия отброшены', () => {
    const stats = coachStats([session({ endsAt: daysAgo(40), entries: ['ATTENDED'] })], 30, NOW);

    assert.equal(stats.sessions, 0);
    assert.equal(stats.attendanceRate, null);
  });

  it('посещаемость считается по отмеченным, неотмеченные — отдельно', () => {
    const stats = coachStats(
      [session({ entries: ['ATTENDED', 'ATTENDED', 'NO_SHOW', 'BOOKED', 'CANCELLED'] })],
      0,
      NOW,
    );

    assert.equal(stats.entries, 5);
    assert.equal(stats.attended, 2);
    assert.equal(stats.noShows, 1);
    assert.equal(stats.cancelled, 1);
    assert.equal(stats.unmarked, 1);
    // Два пришли из трёх отмеченных, а не из пяти записей.
    assert.equal(stats.attendanceRate, 67);
  });

  it('без единой отметки посещаемость пуста, а не ноль', () => {
    const stats = coachStats([session({ entries: ['BOOKED', 'CANCELLED'] })], 0, NOW);

    assert.equal(stats.attendanceRate, null);
    assert.equal(stats.unmarked, 1);
  });

  it('заполненность считает записавшихся без отменивших', () => {
    const stats = coachStats(
      [session({ capacity: 10, entries: ['ATTENDED', 'NO_SHOW', 'CANCELLED', 'CANCELLED'] })],
      0,
      NOW,
    );

    // Двое рассчитывали на занятие из десяти мест; отменившие место освободили.
    assert.equal(stats.averageFill, 20);
  });

  it('среднее число пришедших — с одним знаком', () => {
    const stats = coachStats(
      [
        session({ entries: ['ATTENDED', 'ATTENDED', 'ATTENDED'] }),
        session({ entries: ['ATTENDED', 'ATTENDED'] }),
      ],
      0,
      NOW,
    );

    assert.equal(stats.sessions, 2);
    assert.equal(stats.averageAttendance, 2.5);
  });

  it('без занятий средние пусты', () => {
    const stats = coachStats([], 0, NOW);

    assert.deepEqual(
      { s: stats.sessions, a: stats.averageAttendance, f: stats.averageFill, r: stats.attendanceRate },
      { s: 0, a: null, f: null, r: null },
    );
  });
});
