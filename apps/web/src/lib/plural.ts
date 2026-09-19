/**
 * Русская форма слова по числу: 1 визит, 3 визита, 5 визитов, 11 визитов.
 *
 * Отдельным модулем: копий этой функции в вебе уже несколько, по одной на
 * экран, и новые подписи берут её отсюда.
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;

  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;

  return many;
}
