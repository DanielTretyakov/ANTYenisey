'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { NewsItem } from '@yenisey/types';
import { AppShell } from '@/components/layout/AppShell';
import { NewsBody, newsDate, SectionBadge } from '@/components/news/NewsParts';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody } from '@/components/ui/Card';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/useSession';

/**
 * Одна новость платформы. Черновик и «Для клубов» постороннему сервер
 * отдаёт как несуществующие — 404, и здесь это «новость не найдена».
 */
export default function NewsItemPage() {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const [item, setItem] = useState<NewsItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const viewer = session.status === 'ready' ? session.user.id : session.status;

  useEffect(() => {
    if (viewer === 'loading') return;

    let cancelled = false;

    api
      .newsItem(id)
      .then((loaded) => {
        if (!cancelled) setItem(loaded);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
      });

    return () => {
      cancelled = true;
    };
  }, [id, viewer]);

  return (
    <AppShell>
      <Link href="/news" className="mb-5 inline-block text-[0.875rem] text-text-accent underline underline-offset-2">
        ← Все новости
      </Link>

      {error && <Alert>{error}</Alert>}

      {!item && !error && <p className="text-[0.9375rem] text-text-muted">Загружаю…</p>}

      {item && (
        <Card className="max-w-3xl">
          <CardBody>
            <article>
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <SectionBadge section={item.section} />
                {item.publishedAt && (
                  <time dateTime={item.publishedAt} className="text-[0.8125rem] text-text-subtle">
                    {newsDate(item.publishedAt)}
                  </time>
                )}
              </div>
              <h1 className="mb-5 text-[1.625rem] leading-tight">{item.title}</h1>
              <NewsBody body={item.body} />
            </article>
          </CardBody>
        </Card>
      )}
    </AppShell>
  );
}
