/**
 * Кто работает на смене и кто её планирует (решение владельца от 26.09.2026).
 *
 * Чистый модуль без относительных импортов — его гоняет `node --test`.
 */
import type { Role } from '@yenisey/types';

/** На сколько дней вперёд управляющий планирует смены. */
export const SHIFT_HORIZON_DAYS = 60;

export type Access = { ok: true } | { ok: false; message: string };

/**
 * Можно ли открыть «Смену».
 *
 * Руководитель — всегда. Управляющий — в своих залах. Администратор — только
 * в день своей смены и только в зале смены. `hallId` пуст у маршрутов смены,
 * не привязанных к залу (записи, отметки): тогда хватает любого своего зала.
 */
export function canWorkDesk(input: {
  roles: readonly Role[];
  hallId: string | null;
  managedHallIds: readonly string[];
  shiftHallIdsToday: readonly string[];
}): Access {
  if (input.roles.includes('OWNER')) {
    return { ok: true };
  }

  const mine = (list: readonly string[]): boolean =>
    input.hallId === null ? list.length > 0 : list.includes(input.hallId);

  if (input.roles.includes('MANAGER') && mine(input.managedHallIds)) {
    return { ok: true };
  }

  if (input.roles.includes('ADMIN') && mine(input.shiftHallIdsToday)) {
    return { ok: true };
  }

  return {
    ok: false,
    message: input.roles.includes('ADMIN')
      ? input.shiftHallIdsToday.length > 0
        ? 'Сегодня ваша смена в другом зале'
        : 'Сегодня вы не работаете — смену вам не назначили'
      : 'Смена — для администраторов на смене и руководства зала',
  };
}

/** Может ли смотрящий назначать смены в зале: руководитель — везде, управляющий — в своих. */
export function canPlanHall(roles: readonly Role[], managedHallIds: readonly string[], hallId: string): boolean {
  return roles.includes('OWNER') || (roles.includes('MANAGER') && managedHallIds.includes(hallId));
}

/** Даты «2026-09-26» сравниваются строками — формат это позволяет. */
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);

  return value.toISOString().slice(0, 10);
}

/**
 * Можно ли назначать смену на эту дату: не в прошлом (прошедшие смены — уже
 * история) и не дальше горизонта планирования.
 */
export function shiftDateProblem(date: string, today: string): string | null {
  if (date < today) {
    return 'Смену на прошедший день не назначить';
  }

  if (date > addDays(today, SHIFT_HORIZON_DAYS)) {
    return `Смены назначаются не дальше чем на ${SHIFT_HORIZON_DAYS} дней вперёд`;
  }

  return null;
}
