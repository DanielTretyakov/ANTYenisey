import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PlayerRank } from '@yenisey/types';
import { longDate, placeLabel, quoted, rankStatusLine } from './player.ts';

const reviewer = { clubName: 'Енисей', clubSlug: 'yenisey', at: '2026-09-12T10:00:00.000Z', by: 'Иванов И.' };

const rank = (over: Partial<PlayerRank>): PlayerRank => ({
  rank: 'KMS',
  status: 'PENDING',
  orderNumber: null,
  orderDate: null,
  document: null,
  reviewedBy: null,
  rejectionReason: null,
  version: '2026-09-12T10:00:00.000Z',
  ...over,
});

describe('placeLabel', () => {
  it('без места — участие', () => {
    assert.equal(placeLabel(null), 'участие');
    assert.equal(placeLabel(3), '3 место');
  });
});

describe('quoted', () => {
  it('кавычки — только если своих нет', () => {
    assert.equal(quoted('Енисей'), '«Енисей»');
    assert.equal(quoted('АНТ «Енисей»'), 'АНТ «Енисей»');
  });
});

describe('longDate', () => {
  it('дата без сдвига на часовой пояс', () => {
    assert.equal(longDate('2025-04-12'), '12 апреля 2025 г.');
    assert.equal(longDate('2026-09-12T10:00:00.000Z'), '12 сентября 2026 г.');
  });
});

describe('rankStatusLine', () => {
  it('на проверке', () => {
    assert.equal(rankStatusLine(rank({})), 'не подтверждён клубом');
  });

  it('подтверждён — клуб и дата', () => {
    assert.equal(
      rankStatusLine(rank({ status: 'VERIFIED', reviewedBy: reviewer })),
      'подтвердил клуб «Енисей», 12 сентября 2026 г.',
    );
  });

  it('отклонён — с причиной', () => {
    assert.equal(
      rankStatusLine(rank({ status: 'REJECTED', reviewedBy: reviewer, rejectionReason: 'Нет печати' })),
      'отклонил клуб «Енисей», 12 сентября 2026 г.: Нет печати',
    );
  });

  it('публичный разряд', () => {
    assert.equal(
      rankStatusLine({ rank: 'MS', status: 'VERIFIED', verifiedBy: reviewer }),
      'подтвердил клуб «Енисей», 12 сентября 2026 г.',
    );
  });
});
