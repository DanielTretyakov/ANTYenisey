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

/**
 * Права на устройство клуба (решения владельца от 11.10.2026).
 *
 * Деньги — цены, процент неявки и правило визита абонемента — и удаление
 * залов и столов: только руководство. Управляющий правит только свои залы
 * (`Hall.managerId`) — в «Настройках» и в «Расписании залов»; администратор
 * — только отмеченные ему залы (`AdminHall`, решение от 12.10.2026), и без
 * денег и удаления. Новый зал заводит руководитель: у нового зала ещё нет ни
 * управляющего, ни администраторов, а без цен зал не заводится.
 */
export interface ClubActor {
  userId: string;
  roles: readonly Role[];
  /** Залы, отмеченные человеку как администратору. */
  adminHallIds?: readonly string[];
}

/** Деньги клуба целиком: процент неявки, цены видов, тарифы абонементов. */
export function canSetClubMoney(actor: ClubActor): boolean {
  return hasAnyRole(actor.roles, LEADERSHIP_ROLES);
}

/** Зал «вообще»: название, адрес, часы, столы, расписание. */
export function canEditHall(actor: ClubActor, hall: { id: string; managerId: string | null }): boolean {
  return (
    actor.roles.includes('OWNER') ||
    (actor.roles.includes('MANAGER') && hall.managerId === actor.userId) ||
    (actor.roles.includes('ADMIN') && (actor.adminHallIds ?? []).includes(hall.id))
  );
}

/**
 * Кому отмечать залы администратора: руководитель — любые, управляющий —
 * только свои (добавить и снять можно лишь зал, которым он управляет).
 * Отказ человеческими словами или `null`.
 */
export function adminHallsProblem(input: {
  actor: ClubActor;
  targetRoles: readonly Role[];
  halls: readonly { id: string; managerId: string | null }[];
  before: readonly string[];
  requested: readonly string[];
}): string | null {
  const { actor, targetRoles, halls, before, requested } = input;

  if (!targetRoles.includes('ADMIN')) {
    return 'Залы отмечают только администратору';
  }

  const known = new Set(halls.map((hall) => hall.id));

  if (requested.some((id) => !known.has(id))) {
    return 'Такого зала в клубе нет';
  }

  if (actor.roles.includes('OWNER')) {
    return null;
  }

  if (!actor.roles.includes('MANAGER')) {
    return 'Залы администратора отмечают руководитель и управляющий';
  }

  const mine = new Set(halls.filter((hall) => hall.managerId === actor.userId).map((hall) => hall.id));
  const changed = [
    ...requested.filter((id) => !before.includes(id)),
    ...before.filter((id) => !requested.includes(id)),
  ];

  return changed.every((id) => mine.has(id)) ? null : 'Управляющий отмечает администратору только свои залы';
}

/** Цены зала, удаление зала и его столов. */
export function canSetHallMoney(actor: ClubActor, hall: { managerId: string | null }): boolean {
  return actor.roles.includes('OWNER') || (actor.roles.includes('MANAGER') && hall.managerId === actor.userId);
}

/** Новый зал. */
export function canCreateHall(actor: ClubActor): boolean {
  return actor.roles.includes('OWNER');
}

/** Поля зала, за которыми деньги. */
export const HALL_MONEY_FIELDS = [
  'tableHourPrice',
  'tableExtra30MinPrice',
  'hasRobotOption',
  'robot30MinPrice',
  'robot60MinPrice',
  'robotExtra30MinPrice',
] as const;

/** Поля настроек клуба, за которыми деньги. */
export const CLUB_MONEY_FIELDS = ['noShowChargePercent', 'subscriptionBurnsOnNoShowOnly', 'paymentMode'] as const;

/**
 * Какие из денежных полей правка действительно меняет: присланное, но равное
 * текущему, — не правка (веб шлёт только изменённое, но API этого не обязан
 * знать).
 */
export function moneyTouched(
  fields: readonly string[],
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): string[] {
  return fields.filter((field) => patch[field] !== undefined && patch[field] !== (current[field] ?? null));
}
