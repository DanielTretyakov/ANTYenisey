/**
 * Типы спаррингов (решение владельца от 26.09.2026): конструктор у клуба,
 * тренер выбирает тип, записывая ученика, и ученик платит цену типа — стол
 * в неё входит.
 *
 * Чистый модуль под тестами: `node --test` не принимает относительных
 * импортов (см. CLAUDE.md), всё внешнее приходит аргументами.
 */
import { fullYears } from '@yenisey/types';

export type Decision<T> = ({ ok: true } & T) | { ok: false; message: string };

/**
 * Цена спарринга: цена часа, пропорционально длительности, до копейки.
 *
 * Пропорционально, а не «начатыми получасами», как аренда: у типа одна цифра
 * — цена часа, — и тренер, бронирующий полтора часа, должен получить ровно
 * полторы цены, а не догадываться, как её округлит сервер.
 */
export function sparringPrice(hourPrice: number, durationMinutes: number): number {
  return Math.round((hourPrice * durationMinutes) / 60);
}

/**
 * Подходит ли ученик типу по возрасту — полные годы на ДЕНЬ спарринга, а не на
 * сегодня: детский спарринг через месяц после 14-летия уже не детский.
 */
export function sparringAgeProblem(
  type: { name: string; minAge: number | null; maxAge: number | null },
  birthDate: Date,
  on: Date,
): string | null {
  const age = fullYears(birthDate, on);

  if (type.minAge !== null && age < type.minAge) {
    return `«${type.name}» — с ${type.minAge} ${years(type.minAge)}, ученику на день спарринга ${age}`;
  }

  if (type.maxAge !== null && age > type.maxAge) {
    return `«${type.name}» — до ${type.maxAge} ${years(type.maxAge)} включительно, ученику на день спарринга ${age}`;
  }

  return null;
}

/** Тип спарринга из формы конструктора — после разбора. */
export interface SparringTypeInput {
  name: string;
  hourPrice: number;
  minAge: number | null;
  maxAge: number | null;
  description: string | null;
  isActive: boolean;
}

/**
 * Разбор формы конструктора. Повторяет CHECK'и `SparringType_*`, но отвечает
 * по-человечески до них.
 */
export function parseSparringType(input: {
  name: string;
  hourPrice: number;
  minAge?: number | null;
  maxAge?: number | null;
  description?: string | null;
  isActive?: boolean;
}): Decision<{ value: SparringTypeInput }> {
  const name = input.name.trim().replace(/\s+/g, ' ');

  if (!name) {
    return { ok: false, message: 'Назовите тип спарринга' };
  }

  if (name.length > 100) {
    return { ok: false, message: 'Название — не длиннее 100 символов' };
  }

  if (!Number.isInteger(input.hourPrice) || input.hourPrice < 0 || input.hourPrice > 100_000_000) {
    return { ok: false, message: 'Цена часа — в копейках, от нуля до миллиона рублей' };
  }

  const minAge = input.minAge ?? null;
  const maxAge = input.maxAge ?? null;

  for (const age of [minAge, maxAge]) {
    if (age !== null && (!Number.isInteger(age) || age < 0 || age > 120)) {
      return { ok: false, message: 'Возраст — целым числом лет, от 0 до 120' };
    }
  }

  if (minAge !== null && maxAge !== null && minAge > maxAge) {
    return { ok: false, message: 'Возраст «от» больше, чем «до», — такой тип не подойдёт никому' };
  }

  const description = input.description?.trim() || null;

  if (description !== null && description.length > 1000) {
    return { ok: false, message: 'Описание — не длиннее 1000 символов' };
  }

  return { ok: true, value: { name, hourPrice: input.hourPrice, minAge, maxAge, description, isActive: input.isActive ?? true } };
}

/** Родительный падеж после «с» и «до»: «с 1 года», «до 21 года», «с 14 лет». */
function years(count: number): string {
  return count % 10 === 1 && count % 100 !== 11 ? 'года' : 'лет';
}
