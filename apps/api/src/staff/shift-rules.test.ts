import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays, canPlanHall, canWorkDesk, effectiveShift, isoWeekday, shiftDateProblem, shiftGap, staffJoinProblem } from './shift-rules.ts';

const none = { managedHallIds: [], shiftHallIdsToday: [] };

describe('canWorkDesk', () => {
  it('руководитель — всегда', () => {
    assert.equal(canWorkDesk({ ...none, roles: ['OWNER'], hallId: 'h1' }).ok, true);
  });

  it('управляющий — в своём зале, не в чужом', () => {
    assert.equal(canWorkDesk({ ...none, roles: ['MANAGER'], managedHallIds: ['h1'], hallId: 'h1' }).ok, true);
    assert.equal(canWorkDesk({ ...none, roles: ['MANAGER'], managedHallIds: ['h1'], hallId: 'h2' }).ok, false);
  });

  it('администратор — только в день и в зале смены', () => {
    assert.equal(canWorkDesk({ ...none, roles: ['ADMIN'], shiftHallIdsToday: ['h1'], hallId: 'h1' }).ok, true);
    const other = canWorkDesk({ ...none, roles: ['ADMIN'], shiftHallIdsToday: ['h1'], hallId: 'h2' });
    assert.equal(other.ok, false);
    assert.match(other.ok ? '' : other.message, /в другом зале/);
    const off = canWorkDesk({ ...none, roles: ['ADMIN'], hallId: 'h1' });
    assert.match(off.ok ? '' : off.message, /не работаете/);
  });

  it('маршрут без зала — хватает любой своей смены', () => {
    assert.equal(canWorkDesk({ ...none, roles: ['ADMIN'], shiftHallIdsToday: ['h3'], hallId: null }).ok, true);
    assert.equal(canWorkDesk({ ...none, roles: ['ADMIN'], hallId: null }).ok, false);
  });

  it('управляющий без залов, но администратор на смене — пускаем по смене', () => {
    assert.equal(canWorkDesk({ roles: ['MANAGER', 'ADMIN'], managedHallIds: [], shiftHallIdsToday: ['h1'], hallId: 'h1' }).ok, true);
  });

  it('тренер — нет', () => {
    assert.equal(canWorkDesk({ ...none, roles: ['COACH'], hallId: 'h1' }).ok, false);
  });
});

describe('canPlanHall', () => {
  it('руководитель — любой зал, управляющий — свой', () => {
    assert.equal(canPlanHall(['OWNER'], [], 'h1'), true);
    assert.equal(canPlanHall(['MANAGER'], ['h1'], 'h1'), true);
    assert.equal(canPlanHall(['MANAGER'], ['h1'], 'h2'), false);
    assert.equal(canPlanHall(['ADMIN'], ['h1'], 'h1'), false);
  });
});

describe('shiftDateProblem', () => {
  it('прошлое и слишком далёкое — нельзя', () => {
    assert.match(shiftDateProblem('2026-09-25', '2026-09-26') ?? '', /прошедший/);
    assert.equal(shiftDateProblem('2026-09-26', '2026-09-26'), null);
    assert.equal(shiftDateProblem(addDays('2026-09-26', 60), '2026-09-26'), null);
    assert.match(shiftDateProblem(addDays('2026-09-26', 61), '2026-09-26') ?? '', /вперёд/);
  });
});

describe('staffJoinProblem', () => {
  it('тренер и администратор без смены — записываются', () => {
    assert.equal(staffJoinProblem({ roles: ['COACH'], shiftOnDay: false, ownSession: false }), null);
    assert.equal(staffJoinProblem({ roles: ['ADMIN'], shiftOnDay: false, ownSession: false }), null);
  });

  it('администратор со сменой в этот день — нет', () => {
    assert.match(staffJoinProblem({ roles: ['ADMIN', 'COACH'], shiftOnDay: true, ownSession: false }) ?? '', /смена/);
  });

  it('смена у тренера без роли администратора не считается', () => {
    assert.equal(staffJoinProblem({ roles: ['COACH'], shiftOnDay: true, ownSession: false }), null);
  });

  it('на своё занятие — нет', () => {
    assert.match(staffJoinProblem({ roles: ['COACH'], shiftOnDay: false, ownSession: true }) ?? '', /ведёте вы/);
  });
});

describe('isoWeekday', () => {
  it('понедельник — 1, воскресенье — 7', () => {
    assert.equal(isoWeekday('2026-10-12'), 1);
    assert.equal(isoWeekday('2026-10-17'), 6);
    assert.equal(isoWeekday('2026-10-18'), 7);
  });
});

describe('effectiveShift', () => {
  it('день без ручного назначения — шаблон недели', () => {
    assert.deepEqual(effectiveShift({ manual: false, dayAdminIds: [], templateAdminIds: ['a'] }), {
      adminIds: ['a'],
      source: 'TEMPLATE',
    });
  });

  it('ручной день перекрывает шаблон, даже пустой', () => {
    assert.deepEqual(effectiveShift({ manual: true, dayAdminIds: ['b'], templateAdminIds: ['a'] }).adminIds, ['b']);
    assert.deepEqual(effectiveShift({ manual: true, dayAdminIds: [], templateAdminIds: ['a'] }), {
      adminIds: [],
      source: 'DAY',
    });
  });
});

describe('shiftGap', () => {
  const week = [{ open: '08:00', close: '23:00' }, null, null, null, null, null, null];

  it('кто-то есть — дыры нет', () => {
    assert.equal(shiftGap({ adminIds: ['a'], workingHours: null, weekday: 1 }), false);
  });

  it('никого, часы не указаны — предупредить', () => {
    assert.equal(shiftGap({ adminIds: [], workingHours: null, weekday: 3 }), true);
  });

  it('никого в рабочий день — предупредить, в выходной зала — нет', () => {
    assert.equal(shiftGap({ adminIds: [], workingHours: week, weekday: 1 }), true);
    assert.equal(shiftGap({ adminIds: [], workingHours: week, weekday: 2 }), false);
  });
});
