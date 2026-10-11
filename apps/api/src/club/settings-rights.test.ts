import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moneyTouched, CLUB_MONEY_FIELDS, HALL_MONEY_FIELDS, type ClubActor, type Role } from '@yenisey/types';
import { changeRight, rightProblem } from './settings-rights.ts';

const as = (...roles: Role[]): ClubActor => ({ userId: 'me', roles });
const mine = { managerId: 'me' };
const theirs = { managerId: 'other' };
const nobody = { managerId: null };

test('деньги клуба — руководство, администратору отказ', () => {
  assert.equal(rightProblem(as('OWNER'), 'clubMoney', null), null);
  assert.equal(rightProblem(as('MANAGER'), 'clubMoney', null), null);
  assert.match(rightProblem(as('ADMIN'), 'clubMoney', null) ?? '', /руководитель и управляющий/);
  assert.equal(rightProblem(as('ADMIN'), 'staff', null), null);
});

test('зал: администратор — любой, управляющий — только свой', () => {
  assert.equal(rightProblem(as('ADMIN'), 'hall', theirs), null);
  assert.equal(rightProblem(as('MANAGER'), 'hall', mine), null);
  assert.match(rightProblem(as('MANAGER'), 'hall', theirs) ?? '', /только свои залы/);
  assert.match(rightProblem(as('MANAGER'), 'hall', nobody) ?? '', /только свои залы/);
  // Управляющий и администратор сразу — чужой зал правит как администратор.
  assert.equal(rightProblem(as('MANAGER', 'ADMIN'), 'hall', theirs), null);
});

test('цены зала и удаление: руководитель и управляющий этого зала', () => {
  assert.equal(rightProblem(as('OWNER'), 'hallMoney', theirs), null);
  assert.equal(rightProblem(as('MANAGER'), 'hallMoney', mine), null);
  assert.ok(rightProblem(as('MANAGER'), 'hallMoney', theirs));
  assert.ok(rightProblem(as('ADMIN'), 'hallMoney', mine));
  // Администратор-управляющий в чужом зале цен не меняет.
  assert.ok(rightProblem(as('MANAGER', 'ADMIN'), 'hallMoney', theirs));
});

test('новый зал — только руководитель', () => {
  assert.equal(rightProblem(as('OWNER'), 'createHall', null), null);
  assert.ok(rightProblem(as('MANAGER'), 'createHall', null));
  assert.ok(rightProblem(as('ADMIN'), 'createHall', null));
});

test('право по строке очереди: отменяет тот, кто мог сделать', () => {
  assert.deepEqual(changeRight('CLUB', null, { data: { name: 'Клуб' } }), { right: 'staff', hallId: null });
  assert.deepEqual(changeRight('CLUB', null, { data: { noShowChargePercent: 50 } }), { right: 'clubMoney', hallId: null });
  assert.deepEqual(changeRight('HALL_CREATE', 'h1', { data: {} }), { right: 'createHall', hallId: null });
  assert.deepEqual(changeRight('HALL_UPDATE', 'h1', { data: { name: 'Зал' } }), { right: 'hall', hallId: 'h1' });
  assert.deepEqual(changeRight('HALL_UPDATE', 'h1', { data: { tableHourPrice: 1 } }), { right: 'hallMoney', hallId: 'h1' });
  assert.deepEqual(changeRight('HALL_DELETE', 'h1', {}), { right: 'hallMoney', hallId: 'h1' });
  assert.deepEqual(changeRight('TABLE_CREATE', 't1', { hallId: 'h1', label: 'Стол' }), { right: 'hall', hallId: 'h1' });
  assert.deepEqual(changeRight('TABLE_RENAME', 't1', { hallId: 'h1', label: 'Стол' }), { right: 'hall', hallId: 'h1' });
  assert.deepEqual(changeRight('TABLE_DELETE', 't1', { hallId: 'h1' }), { right: 'hallMoney', hallId: 'h1' });
});

test('деньги в правке — только действительно изменённые поля', () => {
  const current = { noShowChargePercent: 100, subscriptionBurnsOnNoShowOnly: false, name: 'Клуб' };

  assert.deepEqual(moneyTouched(CLUB_MONEY_FIELDS, current, { noShowChargePercent: 100, name: 'Другой' }), []);
  assert.deepEqual(moneyTouched(CLUB_MONEY_FIELDS, current, { noShowChargePercent: 50 }), ['noShowChargePercent']);
  assert.deepEqual(
    moneyTouched(HALL_MONEY_FIELDS, { robot30MinPrice: null, tableHourPrice: 40_000 }, { robot30MinPrice: null, tableHourPrice: 45_000 }),
    ['tableHourPrice'],
  );
});
