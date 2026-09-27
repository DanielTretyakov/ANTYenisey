import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { announceOnSave, EXCERPT_MAX, excerptOf } from './post-rules.ts';

describe('excerptOf', () => {
  it('первый абзац целиком, пробелы схлопнуты', () => {
    assert.equal(excerptOf('  Скидка 20%\nна аренду  \n\nПодробности у стойки.'), 'Скидка 20% на аренду');
  });

  it('длинный — по слову и с многоточием', () => {
    const long = `${'слово '.repeat(100)}конец`;
    const excerpt = excerptOf(long);

    assert.ok(excerpt.length <= EXCERPT_MAX);
    assert.ok(excerpt.endsWith('слово…'));
  });
});

describe('announceOnSave', () => {
  const at = new Date('2026-09-26T10:00:00Z');

  it('черновик → опубликовано: рассылать', () => {
    assert.equal(announceOnSave(null, at), true);
  });

  it('правка опубликованного и черновика — нет', () => {
    assert.equal(announceOnSave(at, at), false);
    assert.equal(announceOnSave(null, null), false);
    assert.equal(announceOnSave(at, null), false);
  });
});
