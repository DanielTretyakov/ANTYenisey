'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ClubPost } from '@yenisey/types';
import { excerpt, NewsBody, newsDate } from '@/components/news/NewsParts';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { ApiError } from '@/lib/api';
import { useClubApi } from '@/lib/useClubApi';

/** Сколько свежих публикаций грузит колонка — сколько влезет, решает высота. */
const COLUMN_POSTS = 6;
/** Порция окна «Больше новостей». */
const PAGE = 10;

/** Якорь колонки — на него ведут сообщения клиентам и стартовая страница. */
export const NEWS_ANCHOR = 'novosti';

/**
 * Новости клуба: акции и объявления (решения владельца от 26 и 27.09.2026).
 * Общий для всех залов блок — левая колонка над выбором зала, той же высоты,
 * что рейтинг рядом: самые свежие публикации, остальные — в окне «Больше
 * новостей» целиком, с полным текстом.
 */
export function ClubNewsColumn() {
  const club = useClubApi();
  const [posts, setPosts] = useState<ClubPost[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Открытое окно: null — закрыто; иначе — какую публикацию показать первой.
  const [open, setOpen] = useState<string | 'all' | null>(null);

  useEffect(() => {
    club
      .posts({ limit: COLUMN_POSTS })
      .then((page) => {
        setPosts(page.items);
        setTotal(page.total);
      })
      .catch((cause: unknown) => setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен'));
  }, [club]);

  return (
    <section
      id={NEWS_ANCHOR}
      className="flex min-w-0 scroll-mt-24 flex-col rounded-card border border-border bg-surface-raised"
    >
      <header className="border-b border-border px-5 pt-4 pb-3">
        <h2 className="text-[1.375rem]">Новости клуба</h2>
        <p className="mt-1 text-[0.875rem] text-text-muted">Акции и объявления — свежие сверху.</p>
      </header>

      {/* Высота колонки — по соседнему рейтингу (сетка тянет обе): что не
          влезло, уходит под плавное затухание. На телефоне — своя высота. */}
      <div className="relative max-h-[36rem] min-h-0 flex-1 overflow-hidden lg:max-h-none">
        {error ? (
          <p className="px-5 py-4 text-[0.9375rem] text-danger">{error}</p>
        ) : posts === null ? (
          <p className="px-5 py-4 text-[0.9375rem] text-text-muted" aria-busy="true">
            Загружаю…
          </p>
        ) : posts.length === 0 ? (
          <p className="px-5 py-4 text-[0.9375rem] text-text-muted">
            Клуб пока ничего не публиковал. Акции и объявления появятся здесь.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {posts.map((post) => (
                <li key={post.id} className="px-5 py-4">
                  <p className="mb-1 text-[0.8125rem] text-text-subtle">
                    {post.publishedAt && <time dateTime={post.publishedAt}>{newsDate(post.publishedAt)}</time>}
                  </p>
                  <button
                    type="button"
                    onClick={() => setOpen(post.id)}
                    className="text-left text-[1.0625rem] font-semibold text-text hover:text-text-accent"
                  >
                    {post.title}
                  </button>
                  <p className="mt-1 line-clamp-3 text-[0.9375rem] text-text-muted">{excerpt(post.body, 200)}</p>
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
        <Button variant="secondary" size="sm" disabled={!posts || posts.length === 0} onClick={() => setOpen('all')}>
          Больше новостей
        </Button>
        {total > 0 && <span className="text-[0.875rem] text-text-muted">всего {total}</span>}
      </footer>

      {open && <NewsDialog focus={open === 'all' ? null : open} onClose={() => setOpen(null)} />}
    </section>
  );
}

/** Все публикации клуба с полным текстом, порциями. */
function NewsDialog({ focus, onClose }: { focus: string | null; onClose: () => void }) {
  const club = useClubApi();
  const [posts, setPosts] = useState<ClubPost[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (offset: number) => {
      setPending(true);

      try {
        const page = await club.posts({ limit: PAGE, offset });
        setTotal(page.total);
        setPosts((current) => (offset === 0 ? page.items : [...(current ?? []), ...page.items]));
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
      } finally {
        setPending(false);
      }
    },
    [club],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  // Открыли конкретную публикацию — прокручиваем окно к ней.
  useEffect(() => {
    if (focus && posts) {
      document.getElementById(`post-${focus}`)?.scrollIntoView({ block: 'start' });
    }
  }, [focus, posts]);

  return (
    <Dialog title="Новости клуба" onClose={onClose} size="lg">
      <div className="px-6 py-5">
        {error && <p className="mb-3 text-[0.9375rem] text-danger">{error}</p>}

        {posts === null ? (
          <p className="text-[0.9375rem] text-text-muted" aria-busy="true">
            Загружаю…
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {posts.map((post) => (
              <li key={post.id} id={`post-${post.id}`} className="scroll-mt-4 py-5 first:pt-0">
                <p className="mb-1 text-[0.8125rem] text-text-subtle">
                  {post.publishedAt && <time dateTime={post.publishedAt}>{newsDate(post.publishedAt)}</time>}
                  {' · '}
                  {post.author}
                </p>
                <h3 className="mb-2 text-[1.125rem] font-semibold">{post.title}</h3>
                <NewsBody body={post.body} />
              </li>
            ))}
          </ul>
        )}

        {posts && posts.length < total && (
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            pending={pending}
            onClick={() => void load(posts.length)}
          >
            Показать ещё
          </Button>
        )}
      </div>
    </Dialog>
  );
}
