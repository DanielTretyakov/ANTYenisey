/**
 * Перевод денег между хранением и показом.
 *
 * В базе и в API суммы — целые копейки: рубли с дробной частью в двоичной
 * плавающей точке дают 0.1 + 0.2 = 0.30000000000000004, и на длинной аренде
 * такая копейка расходится с кассой. Человеку при этом показывать копейки
 * нельзя — он вводит рубли. Весь перевод собран здесь, на границе показа, и
 * больше не встречается нигде.
 */

/** Копейки → строка для поля ввода: «400» или «400,50». */
export function kopecksToInput(kopecks: number): string {
  const rubles = Math.trunc(kopecks / 100);
  const remainder = Math.abs(kopecks % 100);

  return remainder === 0 ? String(rubles) : `${rubles},${String(remainder).padStart(2, '0')}`;
}

/** Копейки → строка для чтения: «400 ₽», «400,50 ₽». */
export function formatKopecks(kopecks: number): string {
  return `${kopecksToInput(kopecks)} ₽`;
}

/**
 * Строка из поля ввода → копейки. `null`, если введено не число.
 *
 * Принимает и запятую, и точку: на русской раскладке цифровой блок даёт
 * точку, а привычка — запятую, и заставлять человека угадывать разделитель
 * незачем. Пробелы внутри числа («1 200») тоже допускаются: так его
 * подставляет вставка из буфера.
 */
export function inputToKopecks(input: string): number | null {
  const normalized = input.trim().replace(/\s/g, '').replace(',', '.');

  if (normalized === '' || !/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const [rubles, fraction = ''] = normalized.split('.');

  // Умножение через строку, а не Number(x) * 100: 19.99 * 100 в плавающей
  // точке даёт 1998.9999999999998, и Math.round это чинит, но только пока
  // числа маленькие. Сборка из двух целых не ошибается никогда.
  return Number(rubles) * 100 + Number(fraction.padEnd(2, '0'));
}
