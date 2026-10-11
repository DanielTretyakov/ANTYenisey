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

/**
 * Может ли сотрудник записаться на мероприятие своего клуба (решение
 * владельца от 26.09.2026): может, кроме администратора со сменой в этот день
 * в любом зале клуба — он работает — и тренера на собственное занятие.
 */
export function staffJoinProblem(input: {
  roles: readonly Role[];
  /** Есть ли у человека смена в местный день мероприятия. */
  shiftOnDay: boolean;
  /** Мероприятие — занятие, которое ведёт он сам. */
  ownSession: boolean;
}): string | null {
  if (input.ownSession) {
    return 'Это занятие ведёте вы — записаться на него нельзя';
  }

  if (input.roles.includes('ADMIN') && input.shiftOnDay) {
    return 'В этот день у вас смена — на мероприятия клуба записаться нельзя';
  }

  return null;
}

/** День недели даты зала — ISO: 1 — понедельник, 7 — воскресенье. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();

  return day === 0 ? 7 : day;
}

/** Откуда смена дня: назначена руками на этот день или взята из шаблона недели. */
export type ShiftSource = 'DAY' | 'TEMPLATE';

/**
 * Кто на смене в зале в этот день (решение владельца от 10.10.2026): день,
 * назначенный вручную, — его список, даже пустой («в этот день никого»);
 * иначе — шаблон недели зала. Одно правило на «Смену», запрет записи
 * администратору со сменой и «Расписание персонала».
 */
export function effectiveShift(input: {
  manual: boolean;
  dayAdminIds: readonly string[];
  templateAdminIds: readonly string[];
}): { adminIds: string[]; source: ShiftSource } {
  return input.manual
    ? { adminIds: [...input.dayAdminIds], source: 'DAY' }
    : { adminIds: [...input.templateAdminIds], source: 'TEMPLATE' };
}

/**
 * Предупредить ли руководство, что на день в зале смены нет: никого — и зал
 * в этот день работает. Часы не указаны — считаем, что работает: молчание
 * обошлось бы неотмеченными записями и неявками от джобы, а лишнее
 * сообщение — одной строкой в MAX. Выходной по часам зала — не дыра.
 */
export function shiftGap(input: {
  adminIds: readonly string[];
  /** `Hall.workingHours`: семь дней с понедельника, `null` — выходной; пусто — не указаны. */
  workingHours: readonly unknown[] | null;
  weekday: number;
}): boolean {
  if (input.adminIds.length > 0) {
    return false;
  }

  return input.workingHours === null || input.workingHours[input.weekday - 1] !== null;
}
