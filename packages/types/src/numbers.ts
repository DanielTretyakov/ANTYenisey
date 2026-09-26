/**
 * Числа для человека (решение владельца от 26.09.2026): пробел между
 * разрядами с четырёх знаков — «4 000», «100 000».
 *
 * Пробел неразрывный: «100 000 ₽» в узкой колонке иначе рвался бы на
 * «100» и «000 ₽». Функция одна на веб и сообщения в MAX — две копии уже
 * расходились: веб писал «12000 ₽», а бот — «12 000 ₽».
 */

const NBSP = '\u00a0';

/** «4 000», «-12 500». Дробная часть не трогается. */
export function groupDigits(value: number | string): string {
  const [whole = '', fraction] = String(value).split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);

  return fraction === undefined ? `${sign}${grouped}` : `${sign}${grouped},${fraction}`;
}

/** Копейки → «4 000 ₽», «350,50 ₽». Копейки показываются, только когда они есть. */
export function formatRubles(kopecks: number): string {
  const whole = Math.trunc(kopecks / 100);
  const rest = Math.abs(kopecks % 100);
  const sign = kopecks < 0 && whole === 0 ? '-' : '';

  return rest === 0
    ? `${sign}${groupDigits(whole)}${NBSP}₽`
    : `${sign}${groupDigits(whole)},${String(rest).padStart(2, '0')}${NBSP}₽`;
}
