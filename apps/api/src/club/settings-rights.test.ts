import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminHallsProblem, moneyTouched, CLUB_MONEY_FIELDS, HALL_MONEY_FIELDS, type ClubActor, type Role } from '@yenisey/types';
import { changeRight, rightProblem } from './settings-rights.ts';

const as = (...roles: Role[]): ClubActor => ({ userId: 'me', roles });
const mine = { id: 'h-mine', managerId: 'me' };
const theirs = { id: 'h-theirs', managerId: 'other' };
const nobody = { id: 'h-nobody', managerId: null };
const adminOf = (...hallIds: string[]): ClubActor => ({ userId: 'me', roles: ['ADMIN'], adminHallIds: hallIds });

test('деньги клуба — руководство, администратору отказ', () => {
  assert.equal(rightProblem(as('OWNER'), 'clubMoney', null), null);
  assert.equal(rightProblem(as('MANAGER'), 'clubMoney', null), null);
  assert.match(rightProblem(as('ADMIN'), 'clubMoney', null) ?? '', /руководитель и управляющий/);
  assert.equal(rightProblem(as('ADMIN'), 'staff', null), null);
});

test('зал: администратор — отмеченные ему, управляющий — свои', () => {
  assert.equal(rightProblem(adminOf('h-theirs'), 'hall', theirs), null);
  assert.match(rightProblem(adminOf('h-theirs'), 'hall', nobody) ?? '', /отмеченные ему залы/);
  assert.match(rightProblem(as('ADMIN'), 'hall', theirs) ?? '', /отмеченные ему залы/);
  assert.equal(rightProblem(as('MANAGER'), 'hall', mine), null);
  assert.match(rightProblem(as('MANAGER'), 'hall', theirs) ?? '', /только свои залы/);
  assert.match(rightProblem(as('MANAGER'), 'hall', nobody) ?? '', /только свои залы/);
  // Управляющий и администратор сразу — чужой зал правит, если он отмечен ему.
  assert.equal(rightProblem({ userId: 'me', roles: ['MANAGER', 'ADMIN'], adminHallIds: ['h-theirs'] }, 'hall', theirs), null);
  assert.ok(rightProblem(as('MANAGER', 'ADMIN'), 'hall', theirs));
  assert.equal(rightProblem(as('OWNER'), 'hall', nobody), null);
});

test('залы администратора отмечают руководитель и управляющий — свои', () => {
  const halls = [mine, theirs, nobody];
  const base = { targetRoles: ['ADMIN'] as Role[], halls, before: ['h-theirs'] };

  assert.equal(adminHallsProblem({ ...base, actor: as('OWNER'), requested: ['h-nobody'] }), null);
  assert.equal(adminHallsProblem({ ...base, actor: as('MANAGER'), requested: ['h-theirs', 'h-mine'] }), null);
  // Снять чужой зал или добавить ничей управляющий не может.
  assert.match(adminHallsProblem({ ...base, actor: as('MANAGER'), requested: [] }) ?? '', /только свои/);
  assert.match(adminHallsProblem({ ...base, actor: as('MANAGER'), requested: ['h-theirs', 'h-nobody'] }) ?? '', /только свои/);
  assert.match(adminHallsProblem({ ...base, actor: as('ADMIN'), requested: [] }) ?? '', /руководитель и управляющий/);
  assert.match(adminHallsProblem({ ...base, actor: as('OWNER'), targetRoles: ['COACH'], requested: [] }) ?? '', /только администратору/);
  assert.match(adminHallsProblem({ ...base, actor: as('OWNER'), requested: ['h-chuzhoi'] }) ?? '', /нет/);
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
