import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bornRange, byBirthday, parseBirthSearch } from './people-filter.ts';

describe('parseBirthSearch', () => {
  it('полная дата — точный поиск', () => {
    assert.deepEqual(parseBirthSearch('17.05.2001'), { kind: 'date', date: '2001-05-17' });
    assert.deepEqual(parseBirthSearch(' 7/5/2001 '), { kind: 'date', date: '2001-05-07' });
  });

  it('день и месяц — день рождения в любом году', () => {
    assert.deepEqual(parseBirthSearch('17.05'), { kind: 'dayMonth', day: 17, month: 5 });
    assert.deepEqual(parseBirthSearch('29.02'), { kind: 'dayMonth', day: 29, month: 2 });
  });

  it('несуществующая дата и не дата — обычный поиск', () => {
    assert.equal(parseBirthSearch('31.04'), null);
    assert.equal(parseBirthSearch('29.02.2001'), null);
    assert.equal(parseBirthSearch('13.13.2001'), null);
    assert.equal(parseBirthSearch('Иванов'), null);
    assert.equal(parseBirthSearch('+79001234567'), null);
  });
});

describe('bornRange', () => {
  const today = new Date('2026-09-26T10:00:00Z');

  it('«от 18» — родился не позже, чем 18 лет назад', () => {
    assert.deepEqual(bornRange(18, undefined, today), { to: '2008-09-26' });
  });

  it('«до 13» — ещё нет 14: родился позже, чем 14 лет назад', () => {
    assert.deepEqual(bornRange(undefined, 13, today), { from: '2012-09-27' });
  });

  it('29 февраля: в невисокосный год день рождения наступает 1 марта', () => {
    // 28.02.2027: родившемуся 29.02.2000 ещё 26, и «от 27» его не берёт.
    assert.deepEqual(bornRange(27, undefined, new Date('2027-02-28T00:00:00Z')), { to: '2000-02-28' });
    assert.deepEqual(bornRange(27, undefined, new Date('2027-03-01T00:00:00Z')), { to: '2000-03-01' });
  });
});

describe('byBirthday', () => {
  it('по дню месяца, год не важен, внутри — по ФИО', () => {
    const people = [
      { birthDate: '1990-09-30', fullName: 'Борисов Б' },
      { birthDate: '2010-09-02', fullName: 'Яковлев Я' },
      { birthDate: '1985-09-30', fullName: 'Андреев А' },
    ];

    assert.deepEqual(
      [...people].sort(byBirthday).map((person) => person.fullName),
      ['Яковлев Я', 'Андреев А', 'Борисов Б'],
    );
  });
});
