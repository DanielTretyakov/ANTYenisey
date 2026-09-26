import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays, canPlanHall, canWorkDesk, shiftDateProblem } from './shift-rules.ts';

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
