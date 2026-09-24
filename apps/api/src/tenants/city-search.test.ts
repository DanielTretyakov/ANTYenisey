import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cityLimit, cityPatterns } from './city-search.ts';

describe('cityPatterns', () => {
  it('пусто и пробелы — поиска нет', () => {
    assert.equal(cityPatterns(undefined), null);
    assert.equal(cityPatterns('   '), null);
  });

  it('начало названия и начало слова, без регистра', () => {
    assert.deepEqual(cityPatterns('  НовГ '), {
      prefix: 'новг%',
      word: '% новг%',
      hyphen: '%-новг%',
    });
  });

  it('е и ё — одна буква', () => {
    assert.equal(cityPatterns('Орел')?.prefix, 'ор_л%');
    assert.equal(cityPatterns('Орёл')?.prefix, 'ор_л%');
  });

  it('подстановки пользователя экранируются', () => {
    assert.equal(cityPatterns('50%_\\')?.prefix, '50\\%\\_\\\\%');
  });

  it('несколько пробелов подряд — один', () => {
    assert.equal(cityPatterns('нижний   новгород')?.prefix, 'нижний новгород%');
  });
});

describe('cityLimit', () => {
  it('по умолчанию двадцать, в пределах 1..50', () => {
    assert.equal(cityLimit(undefined), 20);
    assert.equal(cityLimit(0), 1);
    assert.equal(cityLimit(500), 50);
    assert.equal(cityLimit(7), 7);
  });
});
