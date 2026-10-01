'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ClubPost } from '@yenisey/types';
import { ClubSubpage } from '@/components/club/ClubSubpage';
import { PostMeta } from '@/components/club/ClubPostParts';
import { excerpt } from '@/components/news/NewsParts';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { plural } from '@/lib/plural';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';

const PAGE = 20;

/**
 * Новости клуба целиком — страницей, как новости платформы (решение владельца
 * от 30.09.2026: не всплывающим окном). Приветствие закреплено первым,
 * непрочитанное вошедшим отмечено; полный текст — на странице публикации,
 * там же она и становится прочитанной.
 */
export default function ClubNewsPage() {
  const slug = useClubSlug();
  const club = useClubApi();
  const [posts, setPosts] = useState<ClubPost[] | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (offset: number) => {
      setPending(true);

      try {
        const page = await club.posts({ limit: PAGE, offset });
        setTotal(page.total);
        setUnread(page.unreadCount);
        setLoaded(offset + page.items.length);
        setPosts((current) =>
          offset === 0 ? [...(page.pinned ? [page.pinned] : []), ...page.items] : [...(current ?? []), ...page.items],
        );
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

  return (
    <ClubSubpage
      title="Новости клуба"
      description="Приветствие, акции и объявления — свежие сверху. Новое для вас отмечено точкой и гаснет, когда вы откроете публикацию."
    >
      {error && <Alert>{error}</Alert>}

      {unread > 0 && (
        <p className="mb-4 inline-flex rounded-full bg-accent px-3 py-1 text-[0.875rem] font-medium text-accent-text">
          {unread} {plural(unread, 'новая', 'новые', 'новых')}
        </p>
      )}

      <Card>
        <CardBody>
          {posts === null && !error && <p className="py-4 text-[0.9375rem] text-text-muted">Загружаю…</p>}

          {posts !== null && posts.length === 0 && (
            <p className="py-4 text-[0.9375rem] text-text-muted">Клуб пока ничего не публиковал.</p>
          )}

          {posts !== null && posts.length > 0 && (
            <ul className="-mt-5 [&>li:last-child]:border-b-0">
              {posts.map((post) => (
                <li
                  key={post.id}
                  className={cn(
                    'border-b border-border py-5',
                    // Приветствие — плашкой в цвете клуба, а не строкой ленты.
                    post.welcome && 'mt-5 mb-2 rounded-control border-b-0 bg-surface-accent-soft px-4',
                  )}
                >
                  <PostMeta post={post} withAuthor />
                  <Link href={`/clubs/${slug}/news/${post.id}`} className="group block">
                    <h2
                      className={cn(
                        'text-[1.125rem] text-text group-hover:text-text-accent',
                        post.unread ? 'font-bold' : 'font-semibold',
                      )}
                    >
                      {post.title}
                    </h2>
                    <p className="mt-1 text-[0.9375rem] text-text-muted">{excerpt(post.body, 260)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {posts && loaded < total && (
            <div className="mt-5">
              <Button type="button" variant="secondary" pending={pending} onClick={() => void load(loaded)}>
                Показать ещё
              </Button>
            </div>
          )}
        </CardBody>
      </Card>
    </ClubSubpage>
  );
}
