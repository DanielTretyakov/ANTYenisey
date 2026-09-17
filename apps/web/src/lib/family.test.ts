import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canBeGuardianBirthDate, guardianshipLeft, isChildBirthDate } from './family.ts';

const TODAY = new Date('2026-09-17T05:00:00Z');

describe('isChildBirthDate и canBeGuardianBirthDate', () => {
  it('в день шестнадцатилетия — уже не ребёнок', () => {
    assert.equal(isChildBirthDate('2010-09-17', TODAY), false);
    assert.equal(isChildBirthDate('2010-09-18', TODAY), true);
  });

  it('родителем — с восемнадцати', () => {
    assert.equal(canBeGuardianBirthDate('2008-09-17', TODAY), true);
    assert.equal(canBeGuardianBirthDate('2008-09-18', TODAY), false);
  });
});

describe('guardianshipLeft', () => {
  it('годами, месяцами, и меньше месяца', () => {
    assert.equal(guardianshipLeft('2031-06-01', TODAY), 'ещё 4 года');
    assert.equal(guardianshipLeft('2027-02-20', TODAY), 'ещё 5 месяцев');
    assert.equal(guardianshipLeft('2026-10-01', TODAY), 'меньше месяца');
    assert.equal(guardianshipLeft('2037-09-17', TODAY), 'ещё 11 лет');
    assert.equal(guardianshipLeft('2027-10-17', TODAY), 'ещё 1 год');
  });
});
