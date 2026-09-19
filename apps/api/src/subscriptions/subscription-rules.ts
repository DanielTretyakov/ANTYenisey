/**
 * Правила абонементов: какой абонемент платит за запись, что происходит с
 * визитом при отмене и отметке, когда кончается срок.
 *
 * Чистый модуль без относительных импортов: его гоняет `node --test`, а тот
 * требует расширение `.ts`, которого сборка не принимает (см. CLAUDE.md). Всё
 * внешнее — абонементы клиента, «сейчас», пояс зала — приходит аргументами.
 *
 * Главное правило: истинное состояние визита — сама запись, а не журнал.
 * Визит списан при записи и возвращается отменой или прощённой неявкой;
 * «сгорел» — это «не вернулся». Поэтому переход записи из одного состояния в
 * другое сводится к вопросу «израсходован ли визит до и после», и ответ на
 * него — одно движение по журналу или ни одного.
 */

export type EntryStatus = 'BOOKED' | 'ATTENDED' | 'NO_SHOW' | 'CANCELLED';

export type Decision<T> = ({ ok: true } & T) | { ok: false; status: 400 | 409; message: string };

/** Абонемент в том объёме, в каком его читают правила. */
export interface SubscriptionFacts {
  id: string;
  /** Остаток визитов; null — безлимит. */
  remainingVisits: number | null;
  /** Первая минута, когда абонемент уже НЕ действует; null — бессрочный. */
  expiresAt: Date | null;
  trainingTypeIds: readonly string[];
  tournamentTypeIds: readonly string[];
}

/** Мероприятие, за которое платят. */
export interface EventFacts {
  kind: 'TRAINING' | 'TOURNAMENT';
  typeId: string;
  startsAt: Date;
}

export function covers(sub: SubscriptionFacts, event: EventFacts): boolean {
  const types = event.kind === 'TRAINING' ? sub.trainingTypeIds : sub.tournamentTypeIds;

  return types.includes(event.typeId);
}

/**
 * Можно ли заплатить этим абонементом за это мероприятие.
 *
 * Срок сверяется с НАЧАЛОМ мероприятия, а не с моментом записи: абонемент,
 * который истекает в пятницу, не оплачивает субботний турнир, даже если на
 * него записались в среду.
 */
export function usable(sub: SubscriptionFacts, event: EventFacts): boolean {
  const inTime = sub.expiresAt === null || event.startsAt.getTime() < sub.expiresAt.getTime();
  const hasVisits = sub.remainingVisits === null || sub.remainingVisits > 0;

  return covers(sub, event) && inTime && hasVisits;
}

/**
 * Какой абонемент платит, когда подходят несколько.
 *
 * Раньше истекающий — первым: иначе визиты короткого абонемента сгорели бы
 * по сроку, пока клиент тратит бессрочные. Бессрочный — последним. При равном
 * сроке — тот, где визитов меньше, чтобы добить почти закончившийся; безлимит
 * считается бесконечным. Дальше — по id, чтобы выбор не зависел от порядка,
 * в котором база отдала строки.
 */
export function pickSubscription<T extends SubscriptionFacts>(subs: readonly T[], event: EventFacts): T | null {
  const candidates = subs.filter((sub) => usable(sub, event));

  candidates.sort(
    (a, b) =>
      compareNullsLast(a.expiresAt?.getTime() ?? null, b.expiresAt?.getTime() ?? null) ||
      compareNullsLast(a.remainingVisits, b.remainingVisits) ||
      a.id.localeCompare(b.id),
  );

  return candidates[0] ?? null;
}

function compareNullsLast(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  return a - b;
}

/**
 * Израсходован ли визит записью в этом состоянии.
 *
 * Записан или пришёл — израсходован. Отменил или не пришёл — по проценту:
 * у записи по абонементу он означает судьбу визита, 100 — израсходован,
 * 0 — возвращён.
 */
export function consumed(entry: { status: EntryStatus; chargeRatio: number | null }): boolean {
  if (entry.status === 'BOOKED' || entry.status === 'ATTENDED') {
    return true;
  }

  return entry.chargeRatio === 100;
}

/** Шаг по визитам: −1 — списать, +1 — вернуть. */
export type VisitStep = -1 | 1;

/**
 * Что сделать с визитом, когда запись перешла из одного состояния в другое.
 *
 * Неявка после записи ничего не меняет — визит уже израсходован, «сгорел»
 * это и значит. Прощённая неявка и отмена по правилу клуба возвращают его,
 * снятое прощение — списывает снова.
 */
export function decideLedger(before: boolean, after: boolean): VisitStep | null {
  if (before === after) {
    return null;
  }

  return after ? -1 : 1;
}

/**
 * Движение по балансу: сколько записать в журнал и что станет с остатком.
 *
 * У безлимита визиты не считаются: строка журнала всё равно пишется — для
 * истории, — но с нулём. Списать с пустого абонемента нельзя: так бывает,
 * когда клуб снимает прощение неявки, а визит уже потрачен на другое.
 */
export function decideMove(
  remainingVisits: number | null,
  step: VisitStep,
): Decision<{ delta: number; balanceAfter: number | null }> {
  if (remainingVisits === null) {
    return { ok: true, delta: 0, balanceAfter: null };
  }

  if (remainingVisits + step < 0) {
    return {
      ok: false,
      status: 409,
      message: 'На абонементе не осталось визитов — сначала скорректируйте баланс',
    };
  }

  return { ok: true, delta: step, balanceAfter: remainingVisits + step };
}

/**
 * Процент при отмене записи по абонементу — то есть судьба визита.
 *
 * Мягкое правило клуба (по умолчанию, ТЗ): визит возвращается при любой
 * отмене, даже за минуту до начала. Строгое: поздняя отмена сжигает визит
 * целиком — при любом ненулевом проценте ступени, потому что половины визита
 * не бывает (решение владельца от 19.09.2026).
 */
export function subscriptionCancelRatio(softRule: boolean, tierPercent: number): 0 | 100 {
  if (softRule) {
    return 0;
  }

  return tierPercent > 0 ? 100 : 0;
}

/**
 * Когда абонемент перестаёт действовать.
 *
 * Срок — в днях, до конца местного дня последнего из них: купил 5 марта на
 * 30 дней — действует по 3 апреля включительно, до полуночи по часам клуба.
 * Возвращается первая минута, когда абонемент уже не действует, — полночь
 * после последнего дня. Бессрочный тариф — null.
 */
export function expiryOf(purchasedAt: Date, durationDays: number | null, timezone: string): Date | null {
  if (durationDays === null) {
    return null;
  }

  const [year, month, day] = localDate(purchasedAt, timezone).split('-').map(Number) as [number, number, number];
  const lastDayAfter = new Date(Date.UTC(year, month - 1, day + durationDays));

  return localMidnight(lastDayAfter.toISOString().slice(0, 10), timezone);
}

/** Дата «2026-03-05» по часам зала. */
function localDate(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Полночь местного дня в виде момента времени. Два прохода — на случай перевода часов. */
function localMidnight(date: string, timezone: string): Date {
  const target = Date.parse(`${date}T00:00:00Z`);
  let instant = target;

  for (let pass = 0; pass < 2; pass += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(instant));

    const value = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((part) => part.type === type)?.value ?? '';

    const actual =
      Date.parse(`${value('year')}-${value('month')}-${value('day')}T00:00:00Z`) +
      (Number(value('hour')) * 60 + Number(value('minute'))) * 60_000;

    if (actual === target) {
      break;
    }

    instant -= actual - target;
  }

  return new Date(instant);
}

/** Действует ли абонемент сейчас: срок не истёк и визиты есть. */
export function isActive(sub: Pick<SubscriptionFacts, 'remainingVisits' | 'expiresAt'>, now: Date): boolean {
  const inTime = sub.expiresAt === null || now.getTime() < sub.expiresAt.getTime();

  return inTime && (sub.remainingVisits === null || sub.remainingVisits > 0);
}

/** Причина ручного действия: без пробелов по краям, 1..500 символов. */
export function cleanNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim() ?? '';

  return trimmed === '' ? null : trimmed;
}

/**
 * Ручная корректировка баланса администратором.
 *
 * Причина обязательна: за корректировкой — чужие визиты, а то и деньги,
 * возвращённые клиенту мимо системы (решение владельца: возврат абонемента —
 * это корректировка до нуля с причиной). У безлимита визитов нет, и
 * корректировать нечего — его закрывают досрочно.
 */
export function decideAdjustment(
  sub: Pick<SubscriptionFacts, 'remainingVisits'>,
  delta: number,
  note: string | null,
): Decision<{ delta: number; balanceAfter: number }> {
  if (!note) {
    return { ok: false, status: 400, message: 'Укажите причину — клиент и клуб увидят её в истории абонемента' };
  }

  if (note.length > 500) {
    return { ok: false, status: 400, message: 'Причина — не длиннее 500 символов' };
  }

  if (sub.remainingVisits === null) {
    return { ok: false, status: 400, message: 'У безлимита визитов нет — его можно только закрыть досрочно' };
  }

  if (!Number.isInteger(delta) || delta === 0) {
    return { ok: false, status: 400, message: 'Корректировка — целое число визитов, не ноль' };
  }

  const balanceAfter = sub.remainingVisits + delta;

  if (balanceAfter < 0) {
    return {
      ok: false,
      status: 400,
      message: `Нельзя списать больше, чем осталось: на абонементе ${sub.remainingVisits}`,
    };
  }

  return { ok: true, delta, balanceAfter };
}

/**
 * Досрочное закрытие безлимита: срок обрывается сейчас.
 *
 * Только для безлимита — у абонемента с визитами есть корректировка до нуля.
 * Уже истёкший закрывать незачем.
 */
export function decideClose(
  sub: Pick<SubscriptionFacts, 'remainingVisits' | 'expiresAt'>,
  note: string | null,
  now: Date,
): Decision<{ expiresAt: Date }> {
  if (!note) {
    return { ok: false, status: 400, message: 'Укажите причину — клиент и клуб увидят её в истории абонемента' };
  }

  if (sub.remainingVisits !== null) {
    return { ok: false, status: 400, message: 'У абонемента с визитами — корректировка баланса, а не закрытие' };
  }

  if (sub.expiresAt !== null && sub.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, status: 409, message: 'Абонемент уже не действует' };
  }

  return { ok: true, expiresAt: now };
}

/**
 * Правка покрытия тарифа.
 *
 * Добавлять типы можно всегда, убирать — только пока по тарифу нет
 * действующих абонементов: клиент купил «Первую подачу» с турнирами «Клуб 50»,
 * и отнять их у него задним числом нельзя. Нужен другой состав — новый тариф.
 */
export function decidePlanCoverage(
  current: { trainingTypeIds: readonly string[]; tournamentTypeIds: readonly string[] },
  next: { trainingTypeIds: readonly string[]; tournamentTypeIds: readonly string[] },
  activeSubscriptions: number,
): Decision<object> {
  const dropped =
    current.trainingTypeIds.some((id) => !next.trainingTypeIds.includes(id)) ||
    current.tournamentTypeIds.some((id) => !next.tournamentTypeIds.includes(id));

  if (dropped && activeSubscriptions > 0) {
    return {
      ok: false,
      status: 409,
      message: 'По тарифу есть действующие абонементы — убрать из него услугу нельзя. Заведите новый тариф',
    };
  }

  if (next.trainingTypeIds.length === 0 && next.tournamentTypeIds.length === 0) {
    return { ok: false, status: 400, message: 'Тариф должен покрывать хотя бы одну услугу' };
  }

  return { ok: true };
}
