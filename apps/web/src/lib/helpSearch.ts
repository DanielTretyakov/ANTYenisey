/**
 * Поиск по справке: каждое слово запроса должно найтись в заголовке, кратком
 * описании или ключевых словах статьи. Регистр и «ё» не важны — «отменить
 * ребенка» найдёт «Как записать ребёнка и отменить его запись».
 *
 * Чистый модуль без относительных импортов — его гоняет `node --test`.
 */

export interface Searchable {
  title: string;
  summary: string;
  keywords: string[];
}

export function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/[«»"',.!?:;()—–-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Статьи, где нашлись все слова запроса; заголовок важнее описания. Пустой
 * запрос — все статьи как есть.
 */
export function searchHelp<T extends Searchable>(articles: T[], query: string): T[] {
  const words = normalize(query).split(' ').filter(Boolean);

  if (words.length === 0) {
    return articles;
  }

  const scored = articles
    .map((article, index) => {
      const title = normalize(article.title);
      const rest = normalize(`${article.summary} ${article.keywords.join(' ')}`);
      let score = 0;

      for (const word of words) {
        if (title.includes(word)) score += 2;
        else if (rest.includes(word)) score += 1;
        else return null;
      }

      return { article, score, index };
    })
    .filter((item): item is { article: T; score: number; index: number } => item !== null);

  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map((item) => item.article);
}
