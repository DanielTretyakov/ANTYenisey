import type { AttendancePhase, BookingStatus } from '@yenisey/types';

/**
 * Правила отметки присутствия — чистая арифметика, отделённая от базы.
 *
 * За каждой отметкой стоят чужие деньги: неявка списывает процент клуба,
 * исправление его возвращает. Ошибка здесь не падает, а тихо списывает
 * человеку сотню процентов за занятие, на котором он был, — поэтому правила
 * проверяются тестами, а не поднятым Postgres.
 *
 * Относительных импортов нет намеренно: тесты идут через `node --test`, а он
 * требует расширение `.ts`, которого сборка не принимает (см. CLAUDE.md).
 */

/** Итог отметки: пришёл или не пришёл. «Не отмечено» отметкой не бывает. */
export type MarkStatus = 'ATTENDED' | 'NO_SHOW';

/** Запись в том объёме, в каком она влияет на решение. */
export interface EntryState {
  status: BookingStatus;
  chargeRatio: number | null;
  startsAt: Date;
}

export interface MarkRequest {
  status: MarkStatus;
  /** Почему меняется уже поставленная отметка или прощается неявка. */
  reason?: string | null;
  /** Неявка без списания: клиент не пришёл по вине клуба. */
  waiveCharge?: boolean;
}

export type MarkDecision =
  | { ok: false; error: string }
  /** Запись уже в этом состоянии — ничего не меняем и в журнал не пишем. */
  | { ok: true; changed: false }
  | {
      ok: true;
      changed: true;
      status: MarkStatus;
      chargeRatio: number;
      reason: string | null;
      /** Исправление уже поставленной отметки, а не первая отметка. */
      correction: boolean;
    };

/** Полное списание — у состоявшейся записи захватывается вся сумма. */
const FULL = 100;

/**
 * Что делать с запросом на отметку.
 *
 * - Отменённую запись не отмечают: отменил — значит, и не собирался приходить,
 *   и деньги за отмену уже посчитаны по политике.
 * - До начала отмечать нельзя, верхней границы нет. «Пришёл» во время
 *   мероприятия законно: администратор отмечает людей по мере прихода.
 * - Первая отметка — без причины. Исправление уже поставленной — только с
 *   причиной: за ним стоят деньги, и через неделю спорить будет не о чем, если
 *   причины нет.
 * - Вернуть запись в «не отмечено» нельзя. После мероприятия «не отмечено» —
 *   не состояние мира, а незаконченная работа, и снова открыло бы запись для
 *   автонеявки. Любая ошибка исправляется противоположной отметкой.
 * - Простить неявку можно только с причиной и только у неявки: «пришёл без
 *   списания» — бессмыслица, у состоявшейся записи списывается всё.
 *
 * Процент неявки — снимок политики клуба на момент отметки. Клуб поменяет
 * процент завтра — уже отмеченные неявки не пересчитаются, так же как копия
 * цены на момент записи не переписывается новым прайсом.
 */
export function decideMark(
  entry: EntryState,
  request: MarkRequest,
  context: { now: Date; noShowChargePercent: number },
): MarkDecision {
  if (entry.status === 'CANCELLED') {
    return { ok: false, error: 'Запись отменена — отмечать нечего' };
  }

  if (context.now.getTime() < entry.startsAt.getTime()) {
    return { ok: false, error: 'Ещё не началось — присутствие отмечается с момента начала' };
  }

  const reason = normaliseReason(request.reason);
  const waive = request.waiveCharge === true;

  if (waive && request.status === 'ATTENDED') {
    return { ok: false, error: 'Простить списание можно только у неявки' };
  }

  if (waive && reason === null) {
    return { ok: false, error: 'Чтобы простить неявку, укажите причину' };
  }

  const targetRatio = targetRatioOf(entry, request.status, waive, context.noShowChargePercent);

  if (entry.status === request.status && entry.chargeRatio === targetRatio) {
    return { ok: true, changed: false };
  }

  // Первая отметка — у записи, которую ещё никто не трогал.
  const correction = entry.status !== 'BOOKED';

  if (correction && reason === null) {
    return { ok: false, error: 'Отметка уже стоит — чтобы исправить её, укажите причину' };
  }

  return {
    ok: true,
    changed: true,
    status: request.status,
    chargeRatio: targetRatio,
    reason,
    correction,
  };
}

/**
 * Какой процент должен стоять у записи после отметки.
 *
 * Повторная неявка без прощения сохраняет уже снятый процент, а не берёт
 * нынешний процент клуба: иначе смена политики превратила бы безобидный
 * повтор в «исправление» и потребовала бы причину на пустом месте.
 */
function targetRatioOf(
  entry: EntryState,
  status: MarkStatus,
  waive: boolean,
  noShowChargePercent: number,
): number {
  if (status === 'ATTENDED') {
    return FULL;
  }

  if (waive) {
    return 0;
  }

  // Неявка, уже поставленная со списанием, так и остаётся с тем процентом,
  // который тогда сняли. Прощённая (0) — снова становится списываемой.
  if (entry.status === 'NO_SHOW' && entry.chargeRatio !== null && entry.chargeRatio > 0) {
    return entry.chargeRatio;
  }

  return noShowChargePercent;
}

/** Причина из одних пробелов — это отсутствие причины. */
function normaliseReason(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim() ?? '';

  return trimmed === '' ? null : trimmed;
}

// --- Автонеявка и фазы -------------------------------------------------------

/** Политика клуба в том объёме, в каком от неё зависят сроки. */
export interface AttendancePolicy {
  /** Через сколько минут после окончания запись считается просроченной. */
  reminderAfterMinutes: number;
  /** Через сколько минут после окончания неявку фиксирует система. */
  autoNoShowAfterMinutes: number;
  /**
   * С какого момента клуб ведёт учёт присутствия. Записи, закончившиеся
   * раньше, система не трогает: до этой фазы отметить их было нечем, и первый
   * же прогон джобы записал бы в неявки всю историю.
   */
  trackedSince: Date;
}

const MINUTE = 60_000;

/**
 * Когда система сама зафиксирует неявку — или `null`, если не зафиксирует.
 *
 * Отсчёт от окончания, в абсолютных минутах: пороги считаются по времени, а не
 * по календарю, и пояс зала для них не нужен — он нужен только для показа.
 */
export function autoNoShowAt(endsAt: Date, policy: AttendancePolicy): Date | null {
  if (endsAt.getTime() < policy.trackedSince.getTime()) {
    return null;
  }

  return new Date(endsAt.getTime() + policy.autoNoShowAfterMinutes * MINUTE);
}

/**
 * Пора ли джобе фиксировать неявку.
 *
 * Запрос к базе отбирает кандидатов тем же условием, но решение принимается
 * здесь ещё раз: ошибка в запросе — это неявки у людей, которые пришли, и
 * страховка стоит одной строки.
 */
export function decideAutoNoShow(
  entry: { status: BookingStatus; endsAt: Date },
  policy: AttendancePolicy,
  now: Date,
): boolean {
  if (entry.status !== 'BOOKED') {
    return false;
  }

  const at = autoNoShowAt(entry.endsAt, policy);

  return at !== null && at.getTime() <= now.getTime();
}

/**
 * Пора ли напомнить администраторам, что присутствие не отмечено (ТЗ →
 * «Отметка присутствия»: через час после мероприятия).
 *
 * Напоминание одно: `reminderSentAt` ставится той же транзакцией, что и
 * сообщение, и второй проход запись уже не берёт. Записи, которые джоба вот-вот
 * закроет неявкой или уже должна была, не напоминаются — о них придёт итог
 * автонеявки. До начала учёта отметки — тоже нет: отметить их было нечем.
 */
export function escalationDue(
  entry: { status: BookingStatus; endsAt: Date; reminderSentAt: Date | null },
  policy: AttendancePolicy,
  now: Date,
): boolean {
  if (entry.status !== 'BOOKED' || entry.reminderSentAt !== null) {
    return false;
  }

  if (entry.endsAt.getTime() < policy.trackedSince.getTime()) {
    return false;
  }

  const time = now.getTime();

  return (
    time >= entry.endsAt.getTime() + policy.reminderAfterMinutes * MINUTE &&
    time < entry.endsAt.getTime() + policy.autoNoShowAfterMinutes * MINUTE
  );
}

/**
 * Фаза неотмеченной записи: рано, идёт, ждёт отметки, просрочена.
 *
 * Граница «просрочено» включительно: ровно через час после окончания ТЗ уже
 * шлёт напоминание.
 */
export function attendancePhase(
  entry: { startsAt: Date; endsAt: Date },
  policy: Pick<AttendancePolicy, 'reminderAfterMinutes'>,
  now: Date,
): AttendancePhase {
  const time = now.getTime();

  if (time < entry.startsAt.getTime()) {
    return 'UPCOMING';
  }

  if (time < entry.endsAt.getTime()) {
    return 'ONGOING';
  }

  if (time < entry.endsAt.getTime() + policy.reminderAfterMinutes * MINUTE) {
    return 'AWAITING';
  }

  return 'OVERDUE';
}

/**
 * Сколько стоит неявка по этой записи, в процентах цены.
 *
 * Обычно — процент из политики клуба. Два исключения, и оба стоят 100:
 *
 * - **запись по абонементу**: процент у неё означает не долю цены, а судьбу
 *   визита, и «не пришёл» значит «визит израсходован»;
 * - **спарринг**: стол простоял занятым по вине тренера, и клубная политика
 *   отмены, писанная для клиента, к сотруднику отношения не имеет (решение
 *   владельца от 20.09.2026).
 *
 * Одной функцией, потому что спрашивают в двух местах — при отметке
 * администратором и в джобе автонеявки. Разойдясь, они сделали бы одну и ту же
 * неявку разной по цене в зависимости от того, кто успел раньше.
 */
export function noShowRatio(
  kind: 'TABLE' | 'TRAINING' | 'TOURNAMENT',
  entry: { subscriptionId: string | null; coachId: string | null },
  clubPercent: number,
): number {
  if (entry.subscriptionId !== null) {
    return 100;
  }

  // Спарринг — стол, за которым тренер, а не клиент. У записи на занятие
  // тренер тоже заполнен, поэтому вид записи в условии обязателен.
  return kind === 'TABLE' && entry.coachId !== null ? 100 : clubPercent;
}
