import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pageSize, publishedAtAfter, visibleSections } from './news-rules.ts';

describe('visibleSections', () => {
  it('гость и клиент — без «Для клубов»', () => {
    assert.deepEqual(visibleSections({ staff: false, platformOwner: false }), ['GENERAL', 'UPDATES']);
  });

  it('сотрудник клуба и владелец платформы — все три', () => {
    assert.deepEqual(visibleSections({ staff: true, platformOwner: false }), ['GENERAL', 'UPDATES', 'CLUBS']);
    assert.deepEqual(visibleSections({ staff: false, platformOwner: true }), ['GENERAL', 'UPDATES', 'CLUBS']);
  });
});

describe('publishedAtAfter', () => {
  const now = new Date('2026-09-26T10:00:00Z');
  const earlier = new Date('2026-09-20T10:00:00Z');

  it('первая публикация — сейчас', () => {
    assert.equal(publishedAtAfter(null, true, now), now);
  });

  it('правка опубликованного дату не сдвигает', () => {
    assert.equal(publishedAtAfter(earlier, true, now), earlier);
  });

  it('снятие с публикации — снова черновик', () => {
    assert.equal(publishedAtAfter(earlier, false, now), null);
    assert.equal(publishedAtAfter(null, false, now), null);
  });
});

describe('pageSize', () => {
  it('по умолчанию, предел и мусор', () => {
    assert.equal(pageSize(undefined), 20);
    assert.equal(pageSize(3), 3);
    assert.equal(pageSize(500), 50);
    assert.equal(pageSize(0), 20);
    assert.equal(pageSize(2.5), 20);
  });
});
