/**
 * Кто какие новости платформы видит и как ставится дата публикации
 * (решение владельца от 26.09.2026).
 *
 * Чистый модуль без относительных импортов — его гоняет `node --test`.
 */
import { NEWS_SECTIONS, type NewsSection } from '@yenisey/types';

/**
 * Разделы, видимые смотрящему. «Для клубов» — только сотрудникам клубов
 * (любая роль, кроме клиента, в действующем членстве) и владельцу платформы:
 * там пишут о том, что меняется в работе клуба, и клиенту это ни к чему.
 */
export function visibleSections(viewer: { staff: boolean; platformOwner: boolean }): NewsSection[] {
  return viewer.staff || viewer.platformOwner
    ? [...NEWS_SECTIONS]
    : NEWS_SECTIONS.filter((section) => section !== 'CLUBS');
}

/**
 * Дата публикации после правки. Первая публикация ставит «сейчас»; правка
 * опубликованного дату не сдвигает — исправленная опечатка иначе поднимала бы
 * старую новость наверх ленты; снятие с публикации возвращает в черновики.
 */
export function publishedAtAfter(before: Date | null, publish: boolean, now: Date): Date | null {
  if (!publish) {
    return null;
  }

  return before ?? now;
}

/** Сколько новостей отдавать за раз: по умолчанию и не больше. */
export const NEWS_PAGE_DEFAULT = 20;
export const NEWS_PAGE_MAX = 50;

export function pageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isInteger(requested) || requested < 1) {
    return NEWS_PAGE_DEFAULT;
  }

  return Math.min(requested, NEWS_PAGE_MAX);
}
