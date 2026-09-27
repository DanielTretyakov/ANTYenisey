/**
 * Фильтры «Состава клуба» по дате рождения — чистые правила под тестами.
 *
 * Самодостаточный модуль: его гоняет `node --test`, а ему нельзя относительных
 * импортов (см. CLAUDE.md).
 */

/**
 * Заглушка из миграции `20260826180000_user_contacts_required`: учёткам, у
 * которых даты не было, поставили 1 января 1900 года. Настоящих людей с такой
 * датой нет (нижняя граница ввода — тот же 1900 год, но живых среди них нет),
 * а без исключения все такие учётки оказались бы именинниками 1 января.
 */
export const BIRTH_PLACEHOLDER = '1900-01-01';

/** Что искать по дате рождения, если строка поиска — дата. */
export type BirthSearch =
  | { kind: 'date'; date: string }
  | { kind: 'dayMonth'; day: number; month: number };

/**
 * Строка поиска как дата рождения: «17.05.2001» — точная дата, «17.05» —
 * день рождения в любом году. Иначе null — строка ищется по ФИО, почте и
 * телефону, как раньше. Разделители — точка, косая черта или дефис: так
 * диктуют и так набирают.
 */
export function parseBirthSearch(search: string): BirthSearch | null {
  const match = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}))?$/.exec(search.trim());

  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);

  if (month < 1 || month > 12 || day < 1 || day > daysIn(month, match[3] ? Number(match[3]) : 2000)) {
    return null;
  }

  if (!match[3]) {
    return { kind: 'dayMonth', day, month };
  }

  return { kind: 'date', date: `${match[3]}-${pad(month)}-${pad(day)}` };
}

/**
 * Возраст «от — до» полных лет → диапазон дат рождения включительно.
 *
 * Человеку `age` полных лет, если он родился не позже, чем `today` минус
 * `age` лет, и позже, чем `today` минус `age + 1` лет. 29 февраля в
 * невисокосный год даёт 1 марта — так же считает `fullYears` (день рождения
 * «ещё не наступил» до 1 марта).
 */
export function bornRange(
  ageFrom: number | undefined,
  ageTo: number | undefined,
  today: Date,
): { from?: string; to?: string } {
  const range: { from?: string; to?: string } = {};

  if (ageFrom !== undefined) {
    range.to = shiftYears(today, -ageFrom);
  }

  if (ageTo !== undefined) {
    // Родившийся ровно `ageTo + 1` лет назад уже старше — отсюда день вперёд.
    range.from = addDay(shiftYears(today, -(ageTo + 1)), 1);
  }

  return range;
}

/**
 * Порядок списка в режиме «дни рождения»: по дню месяца, внутри — по ФИО.
 * Год не участвует: в списке месяца важно, чей праздник раньше.
 */
export function byBirthday<T extends { birthDate: string; fullName: string }>(a: T, b: T): number {
  return a.birthDate.slice(5).localeCompare(b.birthDate.slice(5)) || a.fullName.localeCompare(b.fullName, 'ru');
}

function shiftYears(today: Date, years: number): string {
  const year = today.getUTCFullYear() + years;
  const month = today.getUTCMonth() + 1;
  const day = Math.min(today.getUTCDate(), daysIn(month, year));
  // 29 февраля в невисокосный год — это ещё 28-е: день рождения 29-го
  // наступает 1 марта, и в 28 февраля человек ещё младше.
  return `${year}-${pad(month)}-${pad(day)}`;
}

function addDay(date: string, days: number): string {
  const moved = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
  return moved.toISOString().slice(0, 10);
}

function daysIn(month: number, year: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
