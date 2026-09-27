import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clubAccent, readableOn } from './clubTheme.ts';

describe('readableOn', () => {
  it('на тёмном цвете клуба — белый текст', () => {
    assert.equal(readableOn('#126b54'), '#ffffff');
    assert.equal(readableOn('#000000'), '#ffffff');
  });

  it('на светлом — почти чёрный', () => {
    assert.equal(readableOn('#f5d547'), 'var(--ink-950)');
    assert.equal(readableOn('#ffffff'), 'var(--ink-950)');
  });

  it('клуб без своего цвета не трогает тему', () => {
    assert.deepEqual(clubAccent(null), {});
  });
});
