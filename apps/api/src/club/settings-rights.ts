import {
  CLUB_MONEY_FIELDS,
  HALL_MONEY_FIELDS,
  canCreateHall,
  canEditHall,
  canSetClubMoney,
  canSetHallMoney,
  type ClubActor,
} from '@yenisey/types';

/** Отказ администратору в правке цены вида, спарринга или тарифа. */
export const PRICE_CHANGE_DENIED = 'Цены меняют руководитель и управляющий клуба';

/**
 * Какое право нужно на правку устройства клуба (решения владельца от
 * 11.10.2026). Сами права — общие с вебом, в `@yenisey/types`; здесь —
 * какая правка какого требует и что ответить отказом.
 *
 * - `staff` — любой сотрудник админки (название клуба, контакты);
 * - `hall` — зал «вообще»: управляющий — только свой;
 * - `hallMoney` — цены зала, удаление зала и столов;
 * - `clubMoney` — процент неявки и правило визита абонемента, цены видов и
 *   тарифы;
 * - `createHall` — новый зал.
 */
export type SettingsRight = 'staff' | 'hall' | 'hallMoney' | 'clubMoney' | 'createHall';

export interface RightNeed {
  right: SettingsRight;
  /** Зал, о котором речь, — для `hall` и `hallMoney`. */
  hallId: string | null;
}

/** Право — по строке очереди: отменить правку может тот, кто мог её сделать. */
export function changeRight(kind: string, targetId: string | null, payload: unknown): RightNeed {
  const body = (payload ?? {}) as { data?: Record<string, unknown>; hallId?: unknown };
  const fields = Object.keys(body.data ?? {});
  const hallOfPayload = typeof body.hallId === 'string' ? body.hallId : null;

  switch (kind) {
    case 'CLUB':
      return { right: fields.some((field) => (CLUB_MONEY_FIELDS as readonly string[]).includes(field)) ? 'clubMoney' : 'staff', hallId: null };
    case 'HALL_CREATE':
      return { right: 'createHall', hallId: null };
    case 'HALL_UPDATE':
      return {
        right: fields.some((field) => (HALL_MONEY_FIELDS as readonly string[]).includes(field)) ? 'hallMoney' : 'hall',
        hallId: targetId,
      };
    case 'HALL_DELETE':
      return { right: 'hallMoney', hallId: targetId };
    case 'TABLE_DELETE':
      return { right: 'hallMoney', hallId: hallOfPayload };
    default:
      // TABLE_CREATE, TABLE_RENAME — стол в зале.
      return { right: 'hall', hallId: hallOfPayload };
  }
}

/** Отказ человеческими словами или `null` — можно. */
export function rightProblem(
  actor: ClubActor,
  right: SettingsRight,
  hall: { managerId: string | null } | null,
): string | null {
  const target = hall ?? { managerId: null };

  switch (right) {
    case 'staff':
      return null;
    case 'clubMoney':
      return canSetClubMoney(actor) ? null : 'Цены, процент неявки и тарифы меняют руководитель и управляющий клуба';
    case 'createHall':
      return canCreateHall(actor) ? null : 'Новый зал заводит руководитель клуба';
    case 'hall':
      return canEditHall(actor, target) ? null : 'Управляющий правит только свои залы';
    case 'hallMoney':
      if (canSetHallMoney(actor, target)) return null;

      return actor.roles.includes('MANAGER') && !actor.roles.includes('OWNER')
        ? 'Управляющий правит только свои залы'
        : 'Цены зала и удаление залов и столов — у руководителя и управляющего этого зала';
  }
}
