/**
 * Правила семьи: кто кого может вести и что из этого следует.
 *
 * Расширение сверх ТЗ по решениям владельца от 12.09 и 17.09.2026. Родитель
 * ведёт ребёнка младше 16 — записывает, отменяет, видит историю, ведёт профиль
 * игрока; ребёнок только смотрит.
 *
 * Чистый модуль без относительных импортов: его гоняет `node --test`. Всё
 * внешнее — «сегодня», даты рождения, строки опеки — приходит аргументами.
 * Общий пакет импортируется по имени, это не относительный путь.
 *
 * Возраст в базе не проверить (`now()` не IMMUTABLE, см. constraints.sql,
 * раздел 19), поэтому 16 и 18 живут только здесь — и проверяются в момент
 * действия, без джобы: в день шестнадцатилетия права родителя пропадают сами.
 */
import { CHILD_UNTIL_AGE, fullYears, GUARDIAN_MIN_AGE } from '@yenisey/types';

export type GuardianshipStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'REVOKED';

/**
 * Сколько дней заявка ждёт ответа ребёнка.
 *
 * Заявку отправляет любой взрослый, знающий почту ребёнка, — и висеть вечно
 * она не должна: через месяц «Вас хочет закрепить Иванов И.» уже никто не
 * вспомнит, а подтвердят её по инерции.
 */
export const REQUEST_TTL_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export type Refusal = { ok: false; status: 400 | 403 | 404 | 409; message: string };
export type Decision<T = object> = ({ ok: true } & T) | Refusal;

/** Младше 16: записывает родитель. */
export function isChild(birthDate: Date, today: Date): boolean {
  return fullYears(birthDate, today) < CHILD_UNTIL_AGE;
}

/** С 18: может вести ребёнка. */
export function canBeGuardian(birthDate: Date, today: Date): boolean {
  return fullYears(birthDate, today) >= GUARDIAN_MIN_AGE;
}

/**
 * Есть ли у родителя права на ребёнка прямо сейчас.
 *
 * Только у действующей опеки и только пока ребёнку нет 16. Строка при этом не
 * меняется: в день рождения она остаётся ACTIVE как история, а права кончаются
 * сами — без джобы, которая могла бы не отработать.
 */
export function guardianHasRights(status: GuardianshipStatus, childBirthDate: Date, today: Date): boolean {
  return status === 'ACTIVE' && isChild(childBirthDate, today);
}

const ADULT_ONLY = 'Вести ребёнка может взрослый — с 18 лет';

/**
 * Родитель заводит учётку ребёнку — сам в кабинете или администратор у стойки.
 *
 * Учётка, заведённая этим же действием, закрепляется сразу: подтверждать
 * нечего, пароль от неё родитель и задал.
 */
export function decideCreateChild(input: {
  guardianBirthDate: Date;
  childBirthDate: Date;
  today: Date;
}): Decision {
  if (!canBeGuardian(input.guardianBirthDate, input.today)) {
    return { ok: false, status: 403, message: ADULT_ONLY };
  }

  if (!isChild(input.childBirthDate, input.today)) {
    return {
      ok: false,
      status: 400,
      message: 'С 16 лет человек записывается сам — ему нужна обычная регистрация, а не учётка ребёнка',
    };
  }

  return { ok: true };
}

/** Кому адресована заявка — если такая учётка вообще нашлась. */
export interface RequestTarget {
  userId: string;
  birthDate: Date;
  /** Уже закреплён за кем-то. */
  hasActiveGuardian: boolean;
  /** От этого же взрослого уже ждёт ответа заявка. */
  hasPendingFromRequester: boolean;
}

/**
 * Взрослый просит закрепить уже существующую учётку.
 *
 * Снаружи ответ ОДИН при любом исходе, кроме «вам нет 18»: иначе по ответам
 * можно было бы перебрать почты и узнать, какие из них принадлежат детям.
 * Решение здесь только одно — заводить заявку или молча ничего не делать.
 */
export function decideRequest(input: {
  requesterId: string;
  requesterBirthDate: Date;
  target: RequestTarget | null;
  today: Date;
}): Decision<{ create: boolean }> {
  // Про свой возраст человеку сказать можно — это не чужая тайна.
  if (!canBeGuardian(input.requesterBirthDate, input.today)) {
    return { ok: false, status: 403, message: ADULT_ONLY };
  }

  const target = input.target;
  const create =
    target !== null &&
    target.userId !== input.requesterId &&
    isChild(target.birthDate, input.today) &&
    !target.hasActiveGuardian &&
    !target.hasPendingFromRequester;

  return { ok: true, create };
}

export interface PendingRequest {
  status: GuardianshipStatus;
  childUserId: string;
  guardianBirthDate: Date;
  createdAt: Date;
}

/**
 * Ребёнок отвечает на заявку.
 *
 * Ответить может только он сам. Администратор подтвердить за ребёнка не может:
 * знать почту и дату рождения — не право распоряжаться человеком. Чужая заявка
 * не находится, а не «находится и запрещается».
 */
export function decideAnswer(input: {
  request: PendingRequest;
  answererId: string;
  childBirthDate: Date;
  answer: 'CONFIRM' | 'REJECT';
  today: Date;
}): Decision {
  const { request } = input;

  if (request.childUserId !== input.answererId) {
    return { ok: false, status: 404, message: 'Заявка не найдена' };
  }

  if (request.status !== 'PENDING') {
    return { ok: false, status: 409, message: 'На эту заявку уже ответили' };
  }

  // Отказаться можно всегда: закрыть лишнюю заявку не опасно.
  if (input.answer === 'REJECT') {
    return { ok: true };
  }

  if (input.today.getTime() - request.createdAt.getTime() > REQUEST_TTL_DAYS * DAY_MS) {
    return {
      ok: false,
      status: 409,
      message: 'Заявка устарела — попросите родителя отправить новую',
    };
  }

  if (!isChild(input.childBirthDate, input.today)) {
    return { ok: false, status: 409, message: 'С 16 лет закреплять вас за родителем уже не нужно' };
  }

  if (!canBeGuardian(request.guardianBirthDate, input.today)) {
    return { ok: false, status: 409, message: 'Заявку отправил человек младше 18 лет — принять её нельзя' };
  }

  return { ok: true };
}

/** Кто снимает закрепление. */
export type RevokeActor =
  | { kind: 'guardian' }
  /** Администратор или руководство клуба, где ребёнок состоит. */
  | { kind: 'club-admin' }
  /** Сам ребёнок или посторонний. */
  | { kind: 'other' };

/**
 * Снять действующее закрепление.
 *
 * Родитель — без объяснений. Администратор клуба ребёнка — только с причиной:
 * восстановления пароля в продукте нет, и потерявший учётку родитель иначе
 * навсегда оставил бы ребёнка без записи онлайн. Ребёнок — нет: иначе
 * «родитель руководит» держалось бы на честном слове (решение от 17.09.2026).
 */
export function decideRevoke(input: {
  status: GuardianshipStatus;
  actor: RevokeActor;
  reason: string | null;
}): Decision {
  if (input.status !== 'ACTIVE') {
    return { ok: false, status: 409, message: 'Закрепление уже снято' };
  }

  switch (input.actor.kind) {
    case 'guardian':
      return { ok: true };
    case 'club-admin':
      return input.reason
        ? { ok: true }
        : { ok: false, status: 400, message: 'Объясните, почему закрепление снимает клуб, а не родитель' };
    case 'other':
      return {
        ok: false,
        status: 403,
        message: 'Снять закрепление может родитель или администратор клуба',
      };
  }
}

/**
 * За кого выполняется клиентское действие — запись, отмена, список записей.
 *
 * Без `forId` человек действует сам, и до 16 это закрыто: иначе «родитель
 * руководит» было бы только словами, а ребёнок с учёткой записывался бы сам.
 * С `forId` — только за своего ребёнка младше 16 при действующей опеке.
 *
 * Роль вызывающего в клубе здесь не участвует вовсе: тренер, чей сын ходит в
 * группу, записывает его как обычный родитель (решение от 17.09.2026). Роль
 * проверяется у того, за кого пишут, — это делает guard.
 */
export function decideActing(input: {
  callerId: string;
  callerBirthDate: Date;
  forId: string | null;
  /** Опека вызывающего над `forId`, если она есть. */
  guardianship: { status: GuardianshipStatus } | null;
  /** Дата рождения `forId`. */
  childBirthDate: Date | null;
  today: Date;
}): Decision<{ userId: string; byGuardian: boolean }> {
  if (input.forId === null || input.forId === input.callerId) {
    if (isChild(input.callerBirthDate, input.today)) {
      return {
        ok: false,
        status: 403,
        message: 'До 16 лет записывает родитель — или администратор клуба у стойки',
      };
    }

    return { ok: true, userId: input.callerId, byGuardian: false };
  }

  const allowed =
    input.guardianship !== null &&
    input.childBirthDate !== null &&
    guardianHasRights(input.guardianship.status, input.childBirthDate, input.today);

  if (!allowed) {
    return {
      ok: false,
      status: 403,
      message: 'За другого человека записывает только его родитель, пока ребёнку нет 16',
    };
  }

  return { ok: true, userId: input.forId, byGuardian: true };
}
