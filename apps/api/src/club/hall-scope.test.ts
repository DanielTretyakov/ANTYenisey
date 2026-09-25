import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { availableIn, availableInAny } from '@yenisey/types';
import { hallScopeViolations, refKey, type ScopedRef } from './hall-scope.ts';

describe('availableIn', () => {
  it('без привязки — во всех залах', () => {
    assert.equal(availableIn([], 'h1'), true);
  });

  it('с привязкой — только в своих', () => {
    assert.equal(availableIn(['h1', 'h2'], 'h2'), true);
    assert.equal(availableIn(['h1'], 'h3'), false);
  });
});

describe('availableInAny', () => {
  it('фильтр по городу — хоть в одном зале города', () => {
    assert.equal(availableInAny(['h1'], ['h1', 'h2']), true);
    assert.equal(availableInAny(['h3'], ['h1', 'h2']), false);
    assert.equal(availableInAny([], ['h9']), true);
  });
});

describe('hallScopeViolations', () => {
  const kids: ScopedRef = { kind: 'training', id: 'kids', name: 'Детская тренировка', links: ['abakan'] };
  const coach: ScopedRef = { kind: 'coach', id: 'c1', name: 'Иванов И.', links: ['abakan'] };
  const free: ScopedRef = { kind: 'tournament', id: 'cup', name: 'Абсолют', links: [] };

  it('чужой вид и чужой тренер — по сообщению на каждого', () => {
    const violations = hallScopeViolations('krs', [kids, coach, free], new Set());
    assert.equal(violations.length, 2);
    assert.match(violations[0]!, /Детская тренировка/);
    assert.match(violations[1]!, /Иванов И\./);
  });

  it('свой зал — без нарушений', () => {
    assert.deepEqual(hallScopeViolations('abakan', [kids, coach], new Set()), []);
  });

  it('то, что уже стояло в зале до сужения привязки, правку не запирает', () => {
    assert.deepEqual(hallScopeViolations('krs', [kids], new Set([refKey(kids)])), []);
  });

  it('один вид в десяти окнах — одно сообщение', () => {
    assert.equal(hallScopeViolations('krs', [kids, kids, kids], new Set()).length, 1);
  });
});
