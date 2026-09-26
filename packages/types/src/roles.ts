import type { Role } from './auth';

/**
 * Роли человека в клубе (решение владельца от 26.09.2026): несколько сразу —
 * руководитель или управляющий бывает ещё администратором и тренером,
 * администратор — тренером. CLIENT — «сотрудником не является», только одна.
 *
 * Правила здесь, в общем пакете: по ним сервер пускает на маршруты, а веб
 * решает, что показать в меню. Две копии «кто у нас руководство» разошлись
 * бы на первом же новом разделе.
 */

/** Старшинство: так роли показываются и так сортируется список людей. */
export const ROLE_ORDER: readonly Role[] = ['OWNER', 'MANAGER', 'ADMIN', 'COACH', 'CLIENT'];

/** Руководство клуба: руководитель и управляющий. */
export const LEADERSHIP_ROLES: readonly Role[] = ['OWNER', 'MANAGER'];

/** Кто работает в админке: руководство и администраторы. */
export const MANAGING_ROLES: readonly Role[] = ['OWNER', 'MANAGER', 'ADMIN'];

export function hasAnyRole(roles: readonly Role[], wanted: readonly Role[]): boolean {
  return roles.some((role) => wanted.includes(role));
}

/** Сотрудник — любая роль, кроме клиента. */
export function isStaff(roles: readonly Role[]): boolean {
  return roles.some((role) => role !== 'CLIENT');
}

/**
 * Роли к хранению: без повторов, по старшинству; CLIENT — только когда
 * других нет, а пустой набор — это клиент.
 */
export function normalizeRoles(roles: readonly Role[]): Role[] {
  const staff = ROLE_ORDER.filter((role) => role !== 'CLIENT' && roles.includes(role));

  return staff.length > 0 ? staff : ['CLIENT'];
}
