'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ClubPost } from '@yenisey/types';
import { excerpt } from '@/components/news/NewsParts';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { plural } from '@/lib/plural';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { PostMeta } from './ClubPostParts';
import { SectionHeading } from './SectionHeading';

/**
 * Сколько свежих публикаций под приветствием (решение владельца от
 * 01.10.2026): колонка — плитка мозаики высотой с пьедестал рейтинга, а не
 * лента; остальное — на странице новостей клуба.
 */
const COLUMN_POSTS = 2;

/** Якорь колонки — на него ведут сообщения клиентам и стартовая страница. */
export const NEWS_ANCHOR = 'novosti';

/**
 * Новости клуба: акции и объявления (решения владельца от 26, 27 и
 * 30.09.2026). Общий для всех залов блок — левая колонка над выбором зала,
 * той же высоты, что рейтинг рядом: самые свежие публикации выдержками, а
 * целиком — страницей ленты клуба (`/clubs/:slug/news`), не окном.
 *
 * Первым закреплено приветствие клуба. Непрочитанное вошедшим горит точкой
 * цвета клуба и меткой «Новое»; прочитанным оно становится на странице
 * публикации — не когда пролистал колонку с выдержками.
 */
export function ClubNewsColumn() {
  const slug = useClubSlug();
  const club = useClubApi();
  const [posts, setPosts] = useState<ClubPost[] | null>(null);
  const [pinned, setPinned] = useState<ClubPost | null>(null);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    club
      .posts({ limit: COLUMN_POSTS })
      .then((page) => {
        setPinned(page.pinned);
        setPosts(page.items);
        setTotal(page.total);
        setUnread(page.unreadCount);
      })
      .catch((cause: unknown) => setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен'));
  }, [club]);

  useEffect(load, [load]);

  const shown = [...(pinned ? [pinned] : []), ...(posts ?? [])];

  return (
    <section
      id={NEWS_ANCHOR}
      className="flex min-w-0 scroll-mt-40 flex-col rounded-card border border-border bg-surface-raised"
    >
      <header className="border-b border-border px-5 pt-4 pb-3">
        <SectionHeading
          className="mb-0"
          title="Новости клуба"
          description="Приветствие, акции и объявления. Новое для вас — с точкой."
          action={
            unread > 0 && (
              <span className="rounded-full bg-accent px-2.5 py-0.5 text-[0.8125rem] font-medium text-accent-text">
                {unread} {plural(unread, 'новая', 'новые', 'новых')}
              </span>
            )
          }
        />
      </header>

      {/* Высота колонки — по соседнему рейтингу (сетка тянет обе): что не
          влезло, уходит под плавное затухание. На телефоне — своя высота. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {error ? (
          <p className="px-5 py-4 text-[0.9375rem] text-danger">{error}</p>
        ) : posts === null ? (
          <p className="px-5 py-4 text-[0.9375rem] text-text-muted" aria-busy="true">
            Загружаю…
          </p>
        ) : shown.length === 0 ? (
          <p className="px-5 py-4 text-[0.9375rem] text-text-muted">
            Клуб пока ничего не публиковал. Акции и объявления появятся здесь.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {shown.map((post) => (
                <li
                  key={post.id}
                  className={cn(
                    'relative px-5',
                    // Закреплённое — «новость дня» (вариант Д от 30.09.2026):
                    // плашкой в цвете клуба и заголовком шрифтом обложки.
                    // Отступы — так, чтобы приветствие и две свежие вошли в
                    // высоту плитки рейтинга (решение от 01.10.2026).
                    post.welcome ? 'bg-gradient-to-br from-surface-accent-soft to-surface-raised py-4' : 'py-3',
                  )}
                >
                  <PostMeta post={post} />
                  <Link
                    href={`/clubs/${slug}/news/${post.id}`}
                    className={cn(
                      'text-left text-text hover:text-text-accent',
                      // Классы не сливаются (`cn` без tailwind-merge) — вес и
                      // размер выбираются одним условием, а не перекрытием.
                      post.welcome
                        ? cn('font-display text-[1.25rem] leading-snug', post.unread ? 'font-medium' : 'font-normal')
                        : cn('text-[1.0625rem]', post.unread ? 'font-bold' : 'font-semibold'),
                    )}
                  >
                    {post.title}
                  </Link>
                  <p className="mt-1 line-clamp-2 text-[0.9375rem] text-text-muted">{excerpt(post.body, 160)}</p>
                </li>
              ))}
            </ul>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface-raised to-transparent"
            />
          </>
        )}
      </div>

      <footer className="flex items-center gap-4 border-t border-border px-5 py-3">
        <Link href={`/clubs/${slug}/news`}>
          <Button variant="secondary" size="sm" disabled={shown.length === 0}>
            Больше новостей
          </Button>
        </Link>
        {total > 0 && <span className="text-[0.875rem] text-text-muted">всего {total}</span>}
      </footer>
    </section>
  );
}
