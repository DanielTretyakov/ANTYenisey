/**
 * Разбор и проверка даты рождения.
 *
 * Отдельным чистым модулем, а не декоратором DTO: границы «не в будущем» и
 * «не полтора века назад» проверяются относительно текущего дня, и такую
 * логику хочется видеть в тесте, а не выяснять её поведение по продукту.
 */

/** Нижняя граница: старше этого людей не бывает, а такая дата — опечатка. */
const MIN_YEAR = 1900;

/**
 * Дата рождения в виде «2001-05-17» → полночь UTC этой даты.
 *
 * Возвращает null, если строка не дата или дата бессмысленна. Полночь именно
 * UTC: колонка типа DATE часов не хранит, а местная полночь на клубе восточнее
 * Гринвича сдвинула бы дату на сутки назад.
 */
export function parseBirthDate(value: string, today: Date = new Date()): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  // Проверка на «такой даты не существует»: 31 февраля Date молча превращает
  // в 3 марта, и без сверки обратно это прошло бы насквозь.
  if (parsed.toISOString().slice(0, 10) !== value) {
    return null;
  }

  if (parsed.getUTCFullYear() < MIN_YEAR) {
    return null;
  }

  // Родиться в будущем нельзя. Сравнение по календарной дате, а не по
  // мгновению: человек, родившийся сегодня, — законный случай.
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  if (parsed.getTime() > todayUtc) {
    return null;
  }

  return parsed;
}

/** Дата из базы → «2001-05-17» для контракта. */
export function formatBirthDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
