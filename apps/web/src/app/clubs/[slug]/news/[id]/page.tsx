'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ClubPost } from '@yenisey/types';
import { ClubSubpage } from '@/components/club/ClubSubpage';
import { PostMeta } from '@/components/club/ClubPostParts';
import { NewsBody } from '@/components/news/NewsParts';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { announcePostsRead } from '@/lib/clubPostsUnread';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { useSession } from '@/lib/useSession';

/**
 * Одна публикация клуба — страницей (решение владельца от 30.09.2026).
 * Открыл — прочитал: вошедшему отметка ставится сразу, и счётчики в шапке и
 * на стартовой узнают об этом событием. Черновик сервер отдаёт как
 * несуществующий — 404.
 */
export default function ClubPostPage() {
  const { id } = useParams<{ id: string }>();
  const slug = useClubSlug();
  const club = useClubApi();
  const session = useSession();
  const [post, setPost] = useState<ClubPost | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Сессия нужна до запроса: вошедшему сервер отвечает, прочитано ли.
  const viewer = session.status === 'ready' ? session.user.id : session.status;

  useEffect(() => {
    if (viewer === 'loading') return;

    let cancelled = false;

    club
      .post(id)
      .then((loaded) => {
        if (cancelled) return;
        setPost(loaded);

        if (loaded.unread) {
          club
            .markPostsRead([loaded.id])
            .then(() => {
              announcePostsRead();
              if (!cancelled) setPost({ ...loaded, unread: false });
            })
            .catch(() => undefined);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
      });

    return () => {
      cancelled = true;
    };
  }, [club, id, viewer]);

  return (
    <ClubSubpage title={post?.title ?? 'Новость клуба'} back={{ href: `/clubs/${slug}/news`, label: 'Все новости клуба' }}>
      {error && <Alert>{error}</Alert>}

      {!post && !error && <p className="text-[0.9375rem] text-text-muted">Загружаю…</p>}

      {post && (
        <Card className="max-w-3xl">
          <CardBody>
            <article>
              <PostMeta post={post} withAuthor />
              <NewsBody body={post.body} className="mt-3" />
            </article>
          </CardBody>
        </Card>
      )}
    </ClubSubpage>
  );
}
