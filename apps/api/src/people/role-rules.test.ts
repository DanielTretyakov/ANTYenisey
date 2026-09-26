import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeRoles } from '@yenisey/types';
import { decideRoles } from './role-rules.ts';

const base = { actorRoles: ['ADMIN'] as const, self: false, otherOwners: 1 };

describe('normalizeRoles', () => {
  it('по старшинству и без повторов', () => {
    assert.deepEqual(normalizeRoles(['COACH', 'ADMIN', 'COACH']), ['ADMIN', 'COACH']);
  });

  it('клиент — только когда нет других; пусто — клиент', () => {
    assert.deepEqual(normalizeRoles(['CLIENT', 'COACH']), ['COACH']);
    assert.deepEqual(normalizeRoles([]), ['CLIENT']);
  });
});

describe('decideRoles', () => {
  it('администратор делает клиента тренером', () => {
    const result = decideRoles({ ...base, before: ['CLIENT'], requested: ['COACH'] });
    assert.deepEqual(result, { ok: true, roles: ['COACH'], added: ['COACH'], removed: ['CLIENT'] });
  });

  it('администратор и тренер сразу', () => {
    const result = decideRoles({ ...base, before: ['COACH'], requested: ['COACH', 'ADMIN'] });
    assert.equal(result.ok && result.roles.join(), 'ADMIN,COACH');
  });

  it('управляющего назначает только руководитель', () => {
    assert.equal(decideRoles({ ...base, before: ['ADMIN'], requested: ['ADMIN', 'MANAGER'] }).ok, false);
    assert.equal(
      decideRoles({ ...base, actorRoles: ['MANAGER'], before: ['ADMIN'], requested: ['MANAGER'] }).ok,
      false,
    );
    assert.equal(decideRoles({ ...base, actorRoles: ['OWNER'], before: ['ADMIN'], requested: ['MANAGER', 'ADMIN'] }).ok, true);
  });

  it('снять управляющего — тоже только руководитель', () => {
    assert.equal(decideRoles({ ...base, before: ['MANAGER', 'ADMIN'], requested: ['ADMIN'] }).ok, false);
  });

  it('управляющий правит администраторов и тренеров', () => {
    assert.equal(decideRoles({ ...base, actorRoles: ['MANAGER'], before: ['CLIENT'], requested: ['ADMIN'] }).ok, true);
  });

  it('последнего руководителя не разжаловать', () => {
    const result = decideRoles({ ...base, actorRoles: ['OWNER'], before: ['OWNER'], requested: ['ADMIN'], otherOwners: 0 });
    assert.equal(result.ok, false);
  });

  it('себе — нельзя', () => {
    assert.equal(decideRoles({ ...base, self: true, before: ['ADMIN'], requested: ['ADMIN', 'COACH'] }).ok, false);
  });

  it('то же самое — не правка', () => {
    assert.equal(decideRoles({ ...base, before: ['COACH', 'ADMIN'], requested: ['ADMIN', 'COACH'] }).ok, false);
  });
});
