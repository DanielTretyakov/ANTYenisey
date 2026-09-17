/**
 * Семья в интерфейсе: кто младше 16 и кто может вести ребёнка.
 *
 * Годы считает общий пакет — тот же, по которому сервер решает, записывается
 * ли человек сам. Здесь только то, что нужно, чтобы не показывать кнопку,
 * которую сервер всё равно отклонит. Решает всегда сервер.
 *
 * Чистый модуль без относительных импортов — его гоняет `node --test`.
 */
import { CHILD_UNTIL_AGE, fullYears, GUARDIAN_MIN_AGE } from '@yenisey/types';

const at = (birthDate: string) => new Date(`${birthDate}T00:00:00Z`);

/** Младше 16: записывает родитель. `birthDate` — «2015-06-01». */
export function isChildBirthDate(birthDate: string, today: Date = new Date()): boolean {
  return fullYears(at(birthDate), today) < CHILD_UNTIL_AGE;
}

/** С 18: может вести ребёнка. */
export function canBeGuardianBirthDate(birthDate: string, today: Date = new Date()): boolean {
  return fullYears(at(birthDate), today) >= GUARDIAN_MIN_AGE;
}

/**
 * Сколько ещё родитель ведёт ребёнка — «ещё 3 года», «ещё 5 месяцев».
 *
 * Словами, а не датой: «до 01.06.2031» заставляет считать в уме, а родителю
 * важно одно — долго ли ещё.
 */
export function guardianshipLeft(until: string, today: Date = new Date()): string {
  const end = at(until);
  const months =
    (end.getUTCFullYear() - today.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - today.getUTCMonth()) -
    (end.getUTCDate() < today.getUTCDate() ? 1 : 0);

  if (months >= 12) {
    const years = Math.floor(months / 12);
    return `ещё ${years} ${plural(years, 'год', 'года', 'лет')}`;
  }

  if (months >= 1) {
    return `ещё ${months} ${plural(months, 'месяц', 'месяца', 'месяцев')}`;
  }

  return 'меньше месяца';
}

function plural(value: number, one: string, few: string, many: string): string {
  const mod100 = value % 100;
  const mod10 = value % 10;

  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;

  return many;
}
