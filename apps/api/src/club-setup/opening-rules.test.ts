import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openingProblems, slugProblem } from './opening-rules.ts';

describe('openingProblems', () => {
  it('без залов — завести зал', () => {
    assert.equal(openingProblems([]).length, 1);
  });

  it('хотя бы один готовый зал — открывать можно', () => {
    assert.deepEqual(
      openingProblems([
        { name: 'Пироги', hasAddress: false, tables: 0 },
        { name: 'Баки', hasAddress: true, tables: 4 },
      ]),
      [],
    );
  });

  it('ни одного готового — названо, чего не хватает каждому', () => {
    assert.deepEqual(
      openingProblems([
        { name: 'Пироги', hasAddress: false, tables: 3 },
        { name: 'Баки', hasAddress: true, tables: 0 },
      ]),
      ['У зала «Пироги» нет адреса', 'В зале «Баки» нет столов'],
    );
  });
});

describe('slugProblem', () => {
  it('строчная латиница и цифры через дефис — годится', () => {
    assert.equal(slugProblem('stolby'), null);
    assert.equal(slugProblem('ant-enisey-2'), null);
  });

  it('заглавные, пробелы, кириллица, двойной дефис, короткий — нет', () => {
    for (const bad of ['Stolby', 'new club', 'столбы', 'a--b', '-ab', 'ab', 'x'.repeat(41)]) {
      assert.notEqual(slugProblem(bad), null, bad);
    }
  });
});
