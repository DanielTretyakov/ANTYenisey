/**
 * Лента клуба (решение владельца от 26.09.2026) — чистые правила под тестами.
 * Без относительных импортов: модуль гоняет `node --test`.
 */

import { plainText } from '@yenisey/types';

/** Сколько символов текста уходит в сообщение клиенту. */
export const EXCERPT_MAX = 300;

/**
 * Начало публикации для сообщения в MAX и браузер: первый абзац, не длиннее
 * `EXCERPT_MAX`, обрезанный по слову. Весь текст в сообщение не кладётся —
 * это приглашение открыть ленту, а не её копия.
 *
 * Пометки разметки снимаются: в MAX звёздочки дошли бы звёздочками.
 */
export function excerptOf(body: string): string {
  const first = plainText(body).trim().split(/\n\s*\n/)[0]!.replace(/\s+/g, ' ').trim();

  if (first.length <= EXCERPT_MAX) {
    return first;
  }

  const cut = first.slice(0, EXCERPT_MAX - 1);
  const space = cut.lastIndexOf(' ');

  return `${(space > EXCERPT_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:—-]+$/, '')}…`;
}

/**
 * Рассылать ли клиентам: когда черновик становится опубликованным. Правка
 * опубликованного не шлёт ничего — иначе исправленная опечатка стала бы
 * вторым сообщением всему клубу; повторную публикацию после снятия держит
 * ключ идемпотентности `club-post:<id>`: сообщение одно на публикацию.
 */
export function announceOnSave(before: Date | null, after: Date | null): boolean {
  return before === null && after !== null;
}

/**
 * Сколько дней публикация может гореть непрочитанной (решение владельца от
 * 30.09.2026). Без окна после выкладки загорелось бы разом всё, что клуб
 * успел опубликовать, а новичок в клубе с годовой лентой увидел бы «48
 * новых». Приветствие горит без срока, пока его не откроют: оно и есть то,
 * что новичку стоит прочесть первым.
 */
export const UNREAD_WINDOW_DAYS = 30;

/** С какого момента опубликованное ещё может быть «новым». */
export function unreadSince(now: Date): Date {
  return new Date(now.getTime() - UNREAD_WINDOW_DAYS * 86_400_000);
}

/** Непрочитана ли публикация для вошедшего. */
export function isUnread(post: { publishedAt: Date | null; welcome: boolean }, read: boolean, now: Date): boolean {
  if (read || post.publishedAt === null) return false;

  return post.welcome || post.publishedAt >= unreadSince(now);
}
