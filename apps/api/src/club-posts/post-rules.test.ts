import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { announceOnSave, EXCERPT_MAX, excerptOf, isUnread } from './post-rules.ts';

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

  it('пометки разметки в сообщение не уходят', () => {
    assert.equal(excerptOf('**Скидка** *20%* на __аренду__\n\nПодробности'), 'Скидка 20% на аренду');
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

describe('isUnread', () => {
  const now = new Date('2026-09-30T10:00:00Z');
  const fresh = new Date('2026-09-25T10:00:00Z');
  const old = new Date('2026-08-01T10:00:00Z');

  it('свежая и не открытая — новая', () => {
    assert.equal(isUnread({ publishedAt: fresh, welcome: false }, false, now), true);
  });

  it('открытая, черновик и старше окна — нет', () => {
    assert.equal(isUnread({ publishedAt: fresh, welcome: false }, true, now), false);
    assert.equal(isUnread({ publishedAt: null, welcome: false }, false, now), false);
    assert.equal(isUnread({ publishedAt: old, welcome: false }, false, now), false);
  });

  it('приветствие горит без срока, пока не открыли', () => {
    assert.equal(isUnread({ publishedAt: old, welcome: true }, false, now), true);
    assert.equal(isUnread({ publishedAt: old, welcome: true }, true, now), false);
  });
});
