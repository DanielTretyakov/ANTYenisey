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
  | 'BOOKING_NO_SHOW'
  | 'SUBSCRIPTION_ENDING'
  | 'RANK_DECIDED'
  | 'GUARDIANSHIP_REQUESTED'
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
 *
 * Решение по разряду и заявка родителя — служебные: они про саму учётку,
 * случаются раз в год, и узнать о них не из сообщения значит не узнать вовсе
 * — ответить на заявку ребёнок может только сам.
 */
export const CATEGORY_OF: Record<NotificationKind, Category> = {
  TEST: 'SERVICE',
  BOOKING_CONFIRMED: 'MY_BOOKINGS',
  BOOKING_CANCELLED: 'MY_BOOKINGS',
  BOOKING_REMINDER: 'MY_BOOKINGS',
  BOOKING_NO_SHOW: 'MY_BOOKINGS',
  SUBSCRIPTION_ENDING: 'MY_SUBSCRIPTION',
  RANK_DECIDED: 'SERVICE',
  GUARDIANSHIP_REQUESTED: 'SERVICE',
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

/**
 * Местное время зала — снаружи, как всё внешнее в чистом модуле: сервис
 * передаёт сюда функции из club/closures.ts, тест — их же.
 */
export interface LocalClock {
  local(instant: Date): { date: string; minutes: number };
  instant(date: string, minute: number): Date;
}

/** Тихие часы: с 22:00 до 08:00 по поясу зала. */
export const QUIET_FROM = 22 * 60;
export const QUIET_UNTIL = 8 * 60;

function inQuietHours(minutes: number): boolean {
  return minutes >= QUIET_FROM || minutes < QUIET_UNTIL;
}

/** «2026-09-23» → «2026-09-24» и назад. Календарь, а не мгновения: DST не при чём. */
function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Когда слать сообщение, чтобы не разбудить человека.
 *
 * В тихие часы — в 08:00 ближайшего утра по поясу зала; днём — сразу
 * (undefined). Сообщение о собственном действии получателя (записался,
 * отменил) тишину не соблюдает: он сам сейчас не спит, и «вы записаны»
 * утром выглядело бы сбоем.
 */
export function sendAfterFor(now: Date, clock: LocalClock, ownAction: boolean): Date | undefined {
  if (ownAction) {
    return undefined;
  }

  const local = clock.local(now);

  if (!inQuietHours(local.minutes)) {
    return undefined;
  }

  const morning = local.minutes >= QUIET_FROM ? shiftDate(local.date, 1) : local.date;

  return clock.instant(morning, QUIET_UNTIL);
}

/** За сколько до начала напоминать. */
export const REMINDER_LEAD_MINUTES = 180;

/** Во сколько напоминать накануне, если утреннее напоминание попало бы в тихие часы. */
export const EVENING_REMINDER_MINUTE = 20 * 60;

/**
 * Когда напомнить о записи.
 *
 * За три часа до начала. Если это время попадает в тихие часы (занятие в
 * 10:00 — напоминание в 07:00), напоминание уезжает на 20:00 накануне: в
 * семь утра человек его не прочтёт, а в восемь уже будет поздно
 * перестраивать утро.
 */
export function reminderAt(startsAt: Date, clock: LocalClock): Date {
  const at = new Date(startsAt.getTime() - REMINDER_LEAD_MINUTES * 60_000);
  const local = clock.local(at);

  if (!inQuietHours(local.minutes)) {
    return at;
  }

  const evening = local.minutes >= QUIET_FROM ? local.date : shiftDate(local.date, -1);

  return clock.instant(evening, EVENING_REMINDER_MINUTE);
}

/** Сколько напоминание может опоздать: планировщик лежал — старое уже не шлём. */
export const REMINDER_STALE_MINUTES = 120;

/**
 * Пора ли напомнить о записи прямо сейчас.
 *
 * Запись, сделанная уже после момента напоминания, напоминания не получает:
 * человек записался на занятие через час — ему только что пришло
 * подтверждение, и второе сообщение следом было бы шумом. Опоздавшее больше
 * чем на два часа не шлётся тоже: планировщик лежал, и «через три часа
 * занятие» за сорок минут до начала вводит в заблуждение.
 */
export function reminderDue(entry: { createdAt: Date; startsAt: Date }, due: Date, now: Date): boolean {
  return (
    due.getTime() <= now.getTime() &&
    now.getTime() - due.getTime() <= REMINDER_STALE_MINUTES * 60_000 &&
    entry.createdAt.getTime() < due.getTime() &&
    now.getTime() < entry.startsAt.getTime()
  );
}

/** Опека над клиентом — в том виде, в каком её читает выбор адресатов. */
export interface GuardianLink {
  guardianUserId: string;
  status: string;
  childBirthDate: Date;
}

/**
 * Кому сообщать о записи клиента: ему самому и родителю, пока тот ведёт
 * ребёнка — опека действует и ребёнку нет 16 (решение по правам —
 * `hasRights`, из guardianship-rules). Родитель записывает и отменяет за
 * ребёнка, и узнать о неявке или напоминании ему нужнее всех.
 */
export function clientRecipients(
  clientId: string,
  guardians: readonly GuardianLink[],
  hasRights: (link: GuardianLink) => boolean,
): string[] {
  const result = [clientId];

  for (const link of guardians) {
    if (hasRights(link) && !result.includes(link.guardianUserId)) {
      result.push(link.guardianUserId);
    }
  }

  return result;
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
