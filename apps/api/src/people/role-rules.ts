/**
 * Смена ролей человека в клубе (решение владельца от 26.09.2026): ролей
 * несколько сразу, управляющего и руководителя назначает руководитель.
 *
 * Чистый модуль без относительных импортов — его гоняет `node --test`.
 */
import { normalizeRoles, type Role } from '@yenisey/types';

export type RolesDecision = { ok: true; roles: Role[]; added: Role[]; removed: Role[] } | { ok: false; message: string };

export function decideRoles(input: {
  /** Роли того, кто меняет. */
  actorRoles: readonly Role[];
  /** Меняет ли человек роли себе. */
  self: boolean;
  before: readonly Role[];
  requested: readonly Role[];
  /** Сколько, кроме этого человека, в клубе действующих руководителей. */
  otherOwners: number;
}): RolesDecision {
  // Себе роли не меняют: единственный руководитель, разжаловавший себя,
  // запирает клуб — вернуть роль будет уже некому.
  if (input.self) {
    return { ok: false, message: 'Свои роли изменить нельзя' };
  }

  const before = normalizeRoles(input.before);
  const roles = normalizeRoles(input.requested);
  const added = roles.filter((role) => !before.includes(role));
  const removed = before.filter((role) => !roles.includes(role));

  if (added.length === 0 && removed.length === 0) {
    return { ok: false, message: 'У человека уже эти роли' };
  }

  // Руководство назначает руководитель: управляющий — «прослойка» между ним
  // и администраторами, и выдавать руководство самому себе подобным он не может.
  const leadershipTouched = [...added, ...removed].some((role) => role === 'OWNER' || role === 'MANAGER');

  if (leadershipTouched && !input.actorRoles.includes('OWNER')) {
    return { ok: false, message: 'Руководителя и управляющего назначает руководитель клуба' };
  }

  // Последнего руководителя не разжаловать: клуб остался бы без того, кто
  // может назначить нового.
  if (removed.includes('OWNER') && input.otherOwners === 0) {
    return { ok: false, message: 'Это единственный руководитель клуба — роль снять нельзя' };
  }

  return { ok: true, roles, added, removed };
}
