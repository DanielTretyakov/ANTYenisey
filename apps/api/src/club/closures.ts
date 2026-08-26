import type {
  ClosurePurpose,
  ClosureRule,
  ClosureSlot,
  DayClosure,
  Weekday,
} from '@yenisey/types';

/**
 * Закрытое время столов: перевод между временем клуба и мгновениями UTC.
 *
 * Недельные правила заданы в местном времени клуба («каждый вторник с 15:00»),
 * а брони — в UTC. Стыковка этих двух систем и живёт здесь, отдельными чистыми
 * функциями: это ровно тот код, который движок бронирования будет звать на
 * каждую попытку занять стол, и ошибка в нём тихо отдаст клиенту время под
 * групповой тренировкой.
 */

/** Сколько минут в сутках. Полночь как конец окна — это 1440, а не 0. */
export const MINUTES_IN_DAY = 1440;

const WEEKDAYS: Record<string, Weekday> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/** Местные день недели, календарная дата и минуты от полуночи для мгновения. */
export function localParts(instant: Date, timezone: string): {
  weekday: Weekday;
  date: string;
  minutes: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    // h23 обязателен: в hourCycle по умолчанию полночь приходит как «24»,
    // и сутки начинались бы с 1440-й минуты.
    hourCycle: 'h23',
  }).formatToParts(instant);

  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  const weekday = WEEKDAYS[value('weekday')];

  if (weekday === undefined) {
    throw new Error(`Не удалось определить день недели в зоне «${timezone}»`);
  }

  return {
    weekday,
    date: `${value('year')}-${value('month')}-${value('day')}`,
    minutes: Number(value('hour')) * 60 + Number(value('minute')),
  };
}

/** Отрезок в пределах одних местных суток. */
interface LocalSegment {
  weekday: Weekday;
  startMinute: number;
  endMinute: number;
}

/**
 * Разбор промежутка на отрезки по местным суткам.
 *
 * Бронь может начаться в 23:30 и кончиться в 00:30 следующего дня — тогда её
 * надо сверять с расписанием двух разных суток. Промежутки длиннее суток
 * здесь не рассматриваются: аренда стола такой не бывает.
 */
export function localSegments(from: Date, to: Date, timezone: string): LocalSegment[] {
  const start = localParts(from, timezone);
  const end = localParts(to, timezone);

  if (start.date === end.date) {
    return [{ weekday: start.weekday, startMinute: start.minutes, endMinute: end.minutes }];
  }

  const segments: LocalSegment[] = [
    { weekday: start.weekday, startMinute: start.minutes, endMinute: MINUTES_IN_DAY },
  ];

  // Ровная полночь даёт пустой отрезок следующего дня — правила соседнего дня
  // такую бронь не касаются, и добавлять его значило бы ловить ложные
  // пересечения.
  if (end.minutes > 0) {
    segments.push({ weekday: end.weekday, startMinute: 0, endMinute: end.minutes });
  }

  return segments;
}

/** Пересекаются ли два полуоткрытых промежутка. Стык пересечением не считается. */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Попадает ли промежуток в занятое время стола.
 *
 * Это и есть вопрос, который движок бронирования задаёт перед тем, как занять
 * стол для клиента. Для администратора он не задаётся вовсе: занятое время
 * закрыто только для самостоятельной онлайн-брони.
 *
 * Окна запрашиваются по дню недели, а не передаются одним списком: бронь с
 * 23:30 до 00:30 попадает в двое суток, и у каждой из них своё расписание.
 * Что именно отдавать на день — шаблон или правленую дату — решает
 * `slotsForDate` на стороне вызывающего.
 */
export function closedBySlots(
  slotsFor: (weekday: Weekday) => readonly ClosureSlot[],
  tableId: string,
  from: Date,
  to: Date,
  timezone: string,
): boolean {
  const segments = localSegments(from, to, timezone);

  return segments.some((segment) =>
    slotsFor(segment.weekday).some(
      (slot) =>
        slot.tableId === tableId &&
        overlaps(segment.startMinute, segment.endMinute, slot.startMinute, slot.endMinute),
    ),
  );
}

/**
 * Первая пара окон, накладывающихся друг на друга, или null.
 *
 * Та же проверка стоит exclusion-констрейнтом в базе, и последнее слово за
 * ней. Здесь она повторена ради сообщения: администратор должен увидеть, какие
 * именно два окна конфликтуют, а не текст ошибки Postgres.
 *
 * Ключ группировки задаётся снаружи: у шаблона недели окна одного стола
 * сравниваются в пределах дня недели, у расписания даты — просто в пределах
 * стола.
 */
export function findOverlap<T extends ClosureSlot>(
  slots: readonly T[],
  groupKey: (slot: T) => string = (slot) => slot.tableId,
): [T, T] | null {
  const groups = new Map<string, T[]>();

  for (const slot of slots) {
    const key = groupKey(slot);
    const group = groups.get(key) ?? [];

    for (const other of group) {
      if (overlaps(slot.startMinute, slot.endMinute, other.startMinute, other.endMinute)) {
        return [other, slot];
      }
    }

    group.push(slot);
    groups.set(key, group);
  }

  return null;
}

/** Ключ группировки для шаблона недели: стол вместе с днём недели. */
export const ruleGroupKey = (rule: { tableId: string; weekday: Weekday }): string =>
  `${rule.tableId} ${rule.weekday}`;

/**
 * Назначения, к которым тренер не относится.
 *
 * Поле там не просто необязательно, а запрещено: иначе в него сложат «просто
 * кого-нибудь», и статистика тренера наберёт чужие часы.
 */
const PURPOSES_WITHOUT_COACH: ClosurePurpose[] = ['RENT', 'ROBOT', 'OTHER'];

/**
 * Назначения, за которыми закрепляется клиент: он занял стол.
 *
 * У тренировки и спарринга участников много, и один «закреплённый» ввёл бы в
 * заблуждение, поэтому там поле запрещено.
 */
const PURPOSES_WITH_CLIENT: ClosurePurpose[] = ['RENT', 'ROBOT'];

/** Человек, закреплённый за окном, — тренер или клиент, смотря по назначению. */
export function attachedPersonId(slot: ClosureSlot): string | null {
  return (PURPOSES_WITH_CLIENT.includes(slot.purpose) ? slot.clientId : slot.coachId) ?? null;
}

/**
 * Нарушения в одном окне: границы, назначение и тренер.
 *
 * Тренировка без тренера не попадёт в его статистику, и через месяц выяснить,
 * кто её вёл, будет неоткуда. Спарринг — промежуточный случай: он всегда с
 * тренером, но заводить его может и администратор, ещё не зная, кто именно
 * проведёт, поэтому тренер там необязателен.
 *
 * Аренда и робот закрепляются за клиентом — тоже необязательно: стол можно
 * занять до того, как известно, кто придёт.
 */
export function slotViolations(slot: ClosureSlot): string[] {
  const violations: string[] = [];
  const when = `${formatMinutes(slot.startMinute)}–${formatMinutes(slot.endMinute)}`;
  // Клиент, не присланный вовсе, приходит как undefined, а не null. Без
  // приведения «тренер у аренды запрещён» срабатывало бы на каждом окне, где
  // поле просто опустили.
  const coachId = slot.coachId ?? null;
  const clientId = slot.clientId ?? null;

  if (slot.startMinute < 0 || slot.endMinute > MINUTES_IN_DAY) {
    violations.push(`Окно ${when} выходит за пределы суток`);
  }

  if (slot.endMinute <= slot.startMinute) {
    violations.push(`Окно ${when} кончается не позже, чем начинается`);
  }

  if (slot.purpose === 'TRAINING' && coachId === null) {
    violations.push(`Тренировка ${when}: назначьте тренера, иначе она не попадёт в его статистику`);
  }

  if (PURPOSES_WITHOUT_COACH.includes(slot.purpose) && coachId !== null) {
    violations.push(`Окно ${when}: тренер указывается только для тренировки и спарринга`);
  }

  if (!PURPOSES_WITH_CLIENT.includes(slot.purpose) && clientId !== null) {
    violations.push(`Окно ${when}: клиент закрепляется только за арендой и роботом`);
  }

  return violations;
}

/**
 * Что занято в зале на конкретную дату.
 *
 * Правленый день ЗАМЕНЯЕТ шаблон целиком, а не дополняет его. Иначе убрать
 * одно занятие в одну субботу было бы нечем: шаблон всё равно закрывал бы это
 * время, и точечная правка перестала бы быть точечной.
 *
 * Пустой список у правленого дня — законный ответ: «в эту субботу тренировок
 * нет, все столы свободны».
 */
export function slotsForDate(
  template: readonly ClosureRule[],
  day: { customised: boolean; closures: readonly DayClosure[] } | null,
  weekday: Weekday,
): ClosureSlot[] {
  if (day?.customised) {
    return [...day.closures];
  }

  return template.filter((rule) => rule.weekday === weekday);
}

/** Минуты от полуночи в «15:00» — для сообщений человеку. */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
