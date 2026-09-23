/**
 * Правила уведомлений: категории, кому какие положены, повторы отправки.
 *
 * Чистый модуль без относительных импортов: его гоняет `node --test`. Типы из
 * схемы здесь повторены строками, а совпадение со схемой проверяет
 * компилятор в notifications.service.ts.
 */

export type NotificationKind =
  | 'TEST'
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_CANCELLED'
  | 'BOOKING_REMINDER'
  | 'ATTENDANCE_ESCALATION_HOUR'
  | 'ATTENDANCE_AUTO_NO_SHOW'
  | 'SUBSCRIPTION_PAST_DUE';

export type Category =
  | 'SERVICE'
  | 'MY_BOOKINGS'
  | 'MY_SUBSCRIPTION'
  | 'COACH_GROUPS'
  | 'CLUB_ALERTS'
  | 'CLUB_DIGEST'
  | 'PLATFORM_DIGEST';

/** Настраиваемые категории — всё, кроме служебной. */
export type ToggleableCategory = Exclude<Category, 'SERVICE'>;

/**
 * Категория каждого типа. Выключает человек категорию, а не тип: выбирать из
 * двадцати типов никто не станет.
 */
export const CATEGORY_OF: Record<NotificationKind, Category> = {
  TEST: 'SERVICE',
  BOOKING_CONFIRMED: 'MY_BOOKINGS',
  BOOKING_CANCELLED: 'MY_BOOKINGS',
  BOOKING_REMINDER: 'MY_BOOKINGS',
  ATTENDANCE_ESCALATION_HOUR: 'CLUB_ALERTS',
  ATTENDANCE_AUTO_NO_SHOW: 'CLUB_ALERTS',
  SUBSCRIPTION_PAST_DUE: 'CLUB_ALERTS',
};

/** Кем человек является — ровно то, от чего зависят его категории. */
export interface Recipient {
  /** Роли в клубах, где членство не отключено. */
  clubRoles: readonly string[];
  platformOwner: boolean;
}

/**
 * Категории, которые человеку есть смысл настраивать, в порядке показа.
 *
 * Свои записи и абонемент — у всех: записаться может любой, и тренер тоже.
 * Остальное — по ролям: администратору нечего делать со сводкой платформы, а
 * клиенту — с делами клуба.
 */
export function availableCategories(recipient: Recipient): ToggleableCategory[] {
  const staff = recipient.clubRoles.some((role) => role === 'ADMIN' || role === 'OWNER');
  const coach = recipient.clubRoles.includes('COACH');
  const result: ToggleableCategory[] = ['MY_BOOKINGS', 'MY_SUBSCRIPTION'];

  if (coach) {
    result.push('COACH_GROUPS');
  }

  if (staff) {
    result.push('CLUB_ALERTS', 'CLUB_DIGEST');
  }

  if (recipient.platformOwner) {
    result.push('PLATFORM_DIGEST');
  }

  return result;
}

/**
 * Включена ли категория у человека.
 *
 * Строки настройки нет — включена: новое уведомление не должно ждать, пока
 * человек зайдёт в настройки и разрешит его. Служебное не выключается вовсе.
 */
export function categoryEnabled(category: Category, disabled: ReadonlySet<string>): boolean {
  return category === 'SERVICE' || !disabled.has(category);
}

const TOGGLEABLE: ReadonlySet<string> = new Set<ToggleableCategory>([
  'MY_BOOKINGS',
  'MY_SUBSCRIPTION',
  'COACH_GROUPS',
  'CLUB_ALERTS',
  'CLUB_DIGEST',
  'PLATFORM_DIGEST',
]);

export function isToggleableCategory(value: string): value is ToggleableCategory {
  return TOGGLEABLE.has(value);
}

/** Сколько раз пробовать отправить, прежде чем признать строку неудачной. */
export const MAX_ATTEMPTS = 5;

/** Сколько живёт ссылка привязки Telegram. */
export const LINK_TOKEN_TTL_MS = 15 * 60_000;

/**
 * Пауза перед повтором после неудачи: 30 с, 1 мин, 2 мин, 4 мин… не больше
 * часа. Нарастающая — чтобы лёгший на полчаса Telegram не получал от нас
 * запрос каждые десять секунд.
 */
export function retryDelay(attempt: number): number {
  const base = 30_000 * 2 ** Math.max(attempt - 1, 0);

  return Math.min(base, 60 * 60_000);
}

/** Что делать со строкой после неудачной попытки номер `attempts`. */
export function afterFailure(
  attempts: number,
  now: Date,
  retryAfterMs?: number,
): { status: 'PENDING'; sendAfter: Date } | { status: 'FAILED' } {
  if (attempts >= MAX_ATTEMPTS) {
    return { status: 'FAILED' };
  }

  return { status: 'PENDING', sendAfter: new Date(now.getTime() + (retryAfterMs ?? retryDelay(attempts))) };
}
