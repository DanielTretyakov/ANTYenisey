/**
 * Новости платформы (решение владельца от 26.09.2026).
 *
 * Пишет только владелец платформы, читают все без входа — кроме раздела
 * «Для клубов»: его видят только сотрудники клубов. В MAX не рассылаются.
 */

export type NewsSection = 'GENERAL' | 'UPDATES' | 'CLUBS';

/** Порядок разделов на странице /news. */
export const NEWS_SECTIONS: NewsSection[] = ['GENERAL', 'UPDATES', 'CLUBS'];

export const NEWS_SECTION_LABELS: Record<NewsSection, string> = {
  GENERAL: 'Общие',
  UPDATES: 'Обновления',
  CLUBS: 'Для клубов',
};

export const NEWS_TITLE_MAX = 160;
export const NEWS_BODY_MAX = 20000;

export interface NewsItem {
  id: string;
  section: NewsSection;
  title: string;
  /** Простой текст; абзацы — через пустую строку. Разметки нет намеренно. */
  body: string;
  /** Пусто — черновик: его видит только владелец платформы. */
  publishedAt: string | null;
  updatedAt: string;
}

/** Лента: новости и разделы, которые смотрящему видны. */
export interface NewsFeed {
  items: NewsItem[];
  sections: NewsSection[];
}

/** Новость от владельца платформы. `published: false` — черновик. */
export interface NewsDraft {
  section: NewsSection;
  title: string;
  body: string;
  published: boolean;
}
