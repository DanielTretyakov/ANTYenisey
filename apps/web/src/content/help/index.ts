import { CLUB_ARTICLES } from './clubs';
import { COACH_ARTICLES, PARENT_ARTICLES } from './family-coaches';
import { PLAYER_ARTICLES } from './players';
import type { HelpArticle } from './types';

export { HELP_AUDIENCES, type HelpArticle, type HelpAudience } from './types';

/**
 * Все статьи справки в порядке оглавления. Тексты пишутся под то, что
 * работает сейчас; изменилась функция — в том же изменении правится статья.
 */
export const HELP_ARTICLES: HelpArticle[] = [...PLAYER_ARTICLES, ...PARENT_ARTICLES, ...COACH_ARTICLES, ...CLUB_ARTICLES];

export function findArticle(slug: string): HelpArticle | null {
  return HELP_ARTICLES.find((article) => article.slug === slug) ?? null;
}

/** Адрес статьи — ссылка на неё из любого экрана продукта. */
export function helpHref(slug: string): string {
  return `/help/${slug}`;
}
