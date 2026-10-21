import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePlayerQuery, surnameAndName } from './player-search-rules.ts';

const NOW = new Date('2026-10-20T12:00:00Z');

describe('parsePlayerQuery', () => {
  it('слова имени и год рождения', () => {
    assert.deepEqual(parsePlayerQuery('Ковалёв Артём 1985', NOW), { words: ['Ковалев', 'Артем'], year: 1985 });
  });

  it('год из будущего и короткие слова не ищутся', () => {
    assert.deepEqual(parsePlayerQuery('И 2099 Петров', NOW), { words: ['Петров'], year: null });
  });

  it('пустой запрос — все', () => {
    assert.deepEqual(parsePlayerQuery('   ', NOW), { words: [], year: null });
  });
});

describe('surnameAndName', () => {
  it('без отчества', () => {
    assert.equal(surnameAndName('Иванов  Пётр Сергеевич'), 'Иванов Пётр');
    assert.equal(surnameAndName('Ци А'), 'Ци А');
  });
});
