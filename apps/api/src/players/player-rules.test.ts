import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canReadFile,
  canSeeProfile,
  cleanText,
  decideRankEdit,
  decideRankReview,
  isProfilePublic,
  participantView,
  type RankState,
} from './player-rules.ts';

// Полные годы проверяются в `guardianship-rules.test.ts`: считает их общий
// пакет, а здесь только то, что профиль на них опирается.
const day = (value: string) => new Date(`${value}T00:00:00Z`);
const TODAY = new Date('2026-09-13T05:00:00Z');

describe('isProfilePublic', () => {
  it('в день четырнадцатилетия профиль открывается', () => {
    assert.equal(isProfilePublic(day('2012-09-13'), TODAY), true);
    assert.equal(isProfilePublic(day('2012-09-14'), TODAY), false);
  });
});

describe('canSeeProfile и canReadFile', () => {
  const child = { ownerId: 'kid', birthDate: day('2014-01-01') };
  const adult = { ownerId: 'adult', birthDate: day('1990-01-01') };
  const stranger = { viewerId: 'x', managesOwner: false, guardsOwner: false };
  const anonymous = { viewerId: null, managesOwner: false, guardsOwner: false };
  const admin = { viewerId: 'adm', managesOwner: true, guardsOwner: false };

  it('взрослого видят все, даже без входа', () => {
    assert.equal(canSeeProfile(adult, anonymous, TODAY), true);
    assert.equal(canReadFile('AVATAR', adult, anonymous, TODAY), true);
  });

  it('младше 14 — только сам и администраторы его клубов', () => {
    assert.equal(canSeeProfile(child, anonymous, TODAY), false);
    assert.equal(canSeeProfile(child, stranger, TODAY), false);
    assert.equal(canSeeProfile(child, { viewerId: 'kid', managesOwner: false, guardsOwner: false }, TODAY), true);
    assert.equal(canSeeProfile(child, admin, TODAY), true);
    assert.equal(canReadFile('AVATAR', child, stranger, TODAY), false);
  });

  it('родитель видит страницу, аватар и скан приказа ребёнка', () => {
    const parent = { viewerId: 'mom', managesOwner: false, guardsOwner: true };
    assert.equal(canSeeProfile(child, parent, TODAY), true);
    assert.equal(canReadFile('AVATAR', child, parent, TODAY), true);
    assert.equal(canReadFile('RANK_DOCUMENT', child, parent, TODAY), true);
  });

  it('скан приказа не видит посторонний даже у взрослого', () => {
    assert.equal(canReadFile('RANK_DOCUMENT', adult, anonymous, TODAY), false);
    assert.equal(canReadFile('RANK_DOCUMENT', adult, stranger, TODAY), false);
    assert.equal(canReadFile('RANK_DOCUMENT', adult, { viewerId: 'adult', managesOwner: false, guardsOwner: false }, TODAY), true);
    assert.equal(canReadFile('RANK_DOCUMENT', adult, admin, TODAY), true);
  });
});

describe('participantView', () => {
  const person = (birthDate: string) => ({
    userId: 'u1',
    name: 'Иванов И.',
    birthDate: day(birthDate),
    avatarFileId: 'f1',
  });

  it('взрослый — кружок с фотографией и ссылкой', () => {
    assert.deepEqual(participantView(person('1990-01-01'), TODAY), {
      userId: 'u1',
      name: 'Иванов И.',
      avatarFileId: 'f1',
    });
  });

  it('младше 14 — только инициалы, без ссылки и фотографии', () => {
    assert.deepEqual(participantView(person('2014-01-01'), TODAY), {
      userId: null,
      name: 'Иванов И.',
      avatarFileId: null,
    });
  });

  it('граница — день четырнадцатилетия, как у самого профиля', () => {
    assert.equal(participantView(person('2012-09-13'), TODAY).userId, 'u1');
    assert.equal(participantView(person('2012-09-14'), TODAY).userId, null);
  });
});

describe('cleanText', () => {
  it('пусто и пробелы — это null', () => {
    assert.equal(cleanText(''), null);
    assert.equal(cleanText('   '), null);
    assert.equal(cleanText(null), null);
    assert.equal(cleanText(undefined), null);
    assert.equal(cleanText('  Viscaria  '), 'Viscaria');
  });
});

const verified: RankState = {
  rank: 'KMS',
  orderNumber: '45-нг',
  orderDate: '2024-11-01',
  hasDocument: false,
  status: 'VERIFIED',
  rejectionReason: null,
};

describe('decideRankEdit', () => {
  it('без приказа и без скана — отказ', () => {
    const result = decideRankEdit(null, { rank: 'KMS', orderNumber: null, orderDate: null, document: 'keep' });
    assert.equal(result.ok, false);
  });

  it('номер без даты — отказ', () => {
    const result = decideRankEdit(null, { rank: 'KMS', orderNumber: '12', orderDate: null, document: 'replace' });
    assert.equal(result.ok, false);
  });

  it('новый разряд со сканом — принят', () => {
    assert.deepEqual(
      decideRankEdit(null, { rank: 'KMS', orderNumber: null, orderDate: null, document: 'replace' }),
      { ok: true, changed: true },
    );
  });

  it('то же самое ещё раз не сбрасывает подтверждение', () => {
    assert.deepEqual(
      decideRankEdit(verified, { rank: 'KMS', orderNumber: '45-нг', orderDate: '2024-11-01', document: 'keep' }),
      { ok: true, changed: false },
    );
  });

  it('другой разряд, другой приказ или новый скан — снова на проверку', () => {
    const base = { rank: 'KMS' as const, orderNumber: '45-нг', orderDate: '2024-11-01', document: 'keep' as const };

    assert.equal((decideRankEdit(verified, { ...base, rank: 'MS' }) as { changed: boolean }).changed, true);
    assert.equal((decideRankEdit(verified, { ...base, orderDate: '2024-11-02' }) as { changed: boolean }).changed, true);
    assert.equal((decideRankEdit(verified, { ...base, document: 'replace' }) as { changed: boolean }).changed, true);
  });

  it('убрать скан, когда приказ указан, — правка; когда скана нет — нет', () => {
    const withScan = { ...verified, hasDocument: true };
    const edit = { rank: 'KMS' as const, orderNumber: '45-нг', orderDate: '2024-11-01', document: 'remove' as const };

    assert.deepEqual(decideRankEdit(withScan, edit), { ok: true, changed: true });
    assert.deepEqual(decideRankEdit(verified, edit), { ok: true, changed: false });
  });

  it('убрать единственное обоснование нельзя', () => {
    const scanOnly = { ...verified, orderNumber: null, orderDate: null, hasDocument: true };
    const result = decideRankEdit(scanOnly, { rank: 'KMS', orderNumber: null, orderDate: null, document: 'remove' });

    assert.equal(result.ok, false);
  });
});

describe('decideRankReview', () => {
  const pending: RankState = { ...verified, status: 'PENDING' };
  const review = { reviewerId: 'adm', playerId: 'p', reason: null };

  it('свой разряд подтвердить нельзя', () => {
    const result = decideRankReview(pending, { ...review, reviewerId: 'p', decision: 'VERIFIED' });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 403);
  });

  it('подтверждение без причины', () => {
    assert.deepEqual(decideRankReview(pending, { ...review, decision: 'VERIFIED' }), {
      ok: true,
      changed: true,
      rejectionReason: null,
      auditReason: null,
    });
  });

  it('отказ без причины — нельзя', () => {
    const result = decideRankReview(pending, { ...review, decision: 'REJECTED' });
    assert.equal(result.ok, false);
  });

  it('отказ с причиной', () => {
    assert.deepEqual(decideRankReview(pending, { ...review, decision: 'REJECTED', reason: 'Не тот приказ' }), {
      ok: true,
      changed: true,
      rejectionReason: 'Не тот приказ',
      auditReason: 'Не тот приказ',
    });
  });

  it('то же решение ещё раз — без изменений', () => {
    const result = decideRankReview(verified, { ...review, decision: 'VERIFIED' });
    assert.deepEqual(result, { ok: true, changed: false, rejectionReason: null, auditReason: null });
  });

  it('пересмотр чужого решения — только с причиной', () => {
    const rejected: RankState = { ...verified, status: 'REJECTED', rejectionReason: 'Нет печати' };

    assert.equal(decideRankReview(rejected, { ...review, decision: 'VERIFIED' }).ok, false);
    assert.deepEqual(decideRankReview(rejected, { ...review, decision: 'VERIFIED', reason: 'Печать есть на втором листе' }), {
      ok: true,
      changed: true,
      rejectionReason: null,
      auditReason: 'Печать есть на втором листе',
    });
  });

  it('отказ с новой причиной поверх отказа — это изменение', () => {
    const rejected: RankState = { ...verified, status: 'REJECTED', rejectionReason: 'Нет печати' };
    const result = decideRankReview(rejected, { ...review, decision: 'REJECTED', reason: 'Приказ другого вида спорта' });

    assert.equal(result.ok && result.changed, true);
  });
});
