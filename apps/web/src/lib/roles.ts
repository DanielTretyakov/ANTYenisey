import { ROLE_ORDER, type Role } from '@yenisey/types';

/** Названия ролей для человека. Одно место на весь веб. */
export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Руководитель',
  MANAGER: 'Управляющий',
  ADMIN: 'Администратор',
  COACH: 'Тренер',
  CLIENT: 'Клиент',
};

/** «Администратор, тренер» — роли по старшинству, первая с заглавной. */
export function rolesLabel(roles: readonly Role[]): string {
  const ordered = ROLE_ORDER.filter((role) => roles.includes(role));
  const text = ordered.map((role) => ROLE_LABELS[role].toLowerCase()).join(', ');

  return text.charAt(0).toUpperCase() + text.slice(1);
}
