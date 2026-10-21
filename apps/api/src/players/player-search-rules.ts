/**
 * Разбор строки «Найти игрока» и имя в выдаче — чистые функции под тестами
 * (`node --test` не принимает относительных импортов, см. CLAUDE.md).
 */

/**
 * «Иванов Пётр 1990» → слова имени и год. Год — четыре цифры от 1900 до
 * нынешнего; «ё» = «е», как в самом поиске. Короче двух букв слово не ищется:
 * «И» нашло бы полплатформы.
 */
export function parsePlayerQuery(query: string, now = new Date()): { words: string[]; year: number | null } {
  const tokens = query
    .replace(/[Ёё]/g, (letter) => (letter === 'Ё' ? 'Е' : 'е'))
    .split(/[\s,.;]+/)
    .filter(Boolean);
  let year: number | null = null;
  const words: string[] = [];

  for (const token of tokens) {
    if (/^\d{4}$/.test(token)) {
      const value = Number(token);
      if (value >= 1900 && value <= now.getUTCFullYear()) year = value;
      continue;
    }

    if (token.length >= 2 && !/^\d+$/.test(token)) words.push(token.slice(0, 50));
  }

  return { words: words.slice(0, 4), year };
}

/** «Иванов Пётр Сергеевич» → «Иванов Пётр»: без отчества (решение от 20.10.2026). */
export function surnameAndName(fullName: string): string {
  return fullName.trim().split(/\s+/).slice(0, 2).join(' ');
}
