'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { NEWS_SECTION_LABELS, type NewsFeed, type NewsItem, type NewsSection } from '@yenisey/types';
import { AppShell } from '@/components/layout/AppShell';
import { NewsRow } from '@/components/news/NewsParts';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Tab } from '@/components/ui/Tab';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/useSession';

const PAGE = 20;

/**
 * Новости платформы (решение владельца от 26.09.2026): «Общие»,
 * «Обновления», «Для клубов». Открыты без входа; «Для клубов» сервер отдаёт
 * только сотрудникам клубов — вкладку рисуем, только если он её прислал.
 *
 * Раздел — в адресе (`?section=UPDATES`), чтобы на него можно было дать
 * ссылку. Читается из `window.location` в эффекте, как выбор «за кого»: без
 * `useSearchParams` и границы Suspense.
 */
export default function NewsPage() {
  const session = useSession();
  const [section, setSection] = useState<NewsSection | null | undefined>(undefined);
  const [feed, setFeed] = useState<NewsFeed | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('section');
    setSection(wanted && wanted in NEWS_SECTION_LABELS ? (wanted as NewsSection) : null);
  }, []);

  // Сессия меняет видимые разделы: вошедший сотрудник видит «Для клубов».
  const viewer = session.status === 'ready' ? session.user.id : session.status;

  useEffect(() => {
    if (section === undefined || viewer === 'loading') return;

    let cancelled = false;
    setFeed(null);

    api
      .news({ section: section ?? undefined, limit: PAGE })
      .then((loaded) => {
        if (cancelled) return;
        setFeed(loaded);
        setMore(loaded.items.length === PAGE);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
      });

    return () => {
      cancelled = true;
    };
  }, [section, viewer]);

  function choose(next: NewsSection | null): void {
    setSection(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('section', next);
    else url.searchParams.delete('section');
    window.history.replaceState(null, '', url);
  }

  async function loadMore(): Promise<void> {
    const last = feed?.items.at(-1);
    if (!feed || !last?.publishedAt) return;

    setLoadingMore(true);

    try {
      const next = await api.news({ section: section ?? undefined, limit: PAGE, before: last.publishedAt });
      setFeed({ ...feed, items: [...feed.items, ...next.items] });
      setMore(next.items.length === PAGE);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setLoadingMore(false);
    }
  }

  const owner = session.status === 'ready' && session.user.platformOwner;

  return (
    <AppShell
      actions={
        owner ? (
          <Link href="/news/editor">
            <Button variant="secondary" size="sm">
              Редактор
            </Button>
          </Link>
        ) : undefined
      }
    >
      <h1 className="mb-2 text-[1.75rem]">Новости платформы</h1>
      <p className="mb-6 max-w-2xl text-[0.9375rem] text-text-muted">
        Что нового в КНТ: общие новости, обновления продукта и — для сотрудников клубов — то, что меняется в работе
        клуба.
      </p>

      <div className="mb-5 flex flex-wrap gap-1.5" role="group" aria-label="Раздел новостей">
        <Tab active={section === null} onClick={() => choose(null)}>
          Все
        </Tab>
        {(feed?.sections ?? []).map((item) => (
          <Tab key={item} active={section === item} onClick={() => choose(item)}>
            {NEWS_SECTION_LABELS[item]}
          </Tab>
        ))}
      </div>

      {error && <Alert>{error}</Alert>}

      <Card>
        <CardBody>
          {feed === null && !error && <p className="py-4 text-[0.9375rem] text-text-muted">Загружаю…</p>}

          {feed !== null && feed.items.length === 0 && (
            <p className="py-4 text-[0.9375rem] text-text-muted">Здесь пока ничего нет.</p>
          )}

          {feed !== null && feed.items.length > 0 && (
            <ul className="-mt-5 [&>li:last-child]:border-b-0">
              {feed.items.map((item: NewsItem) => (
                <NewsRow key={item.id} item={item} />
              ))}
            </ul>
          )}

          {more && (
            <div className="mt-5">
              <Button type="button" variant="secondary" pending={loadingMore} onClick={() => void loadMore()}>
                Показать ещё
              </Button>
            </div>
          )}
        </CardBody>
      </Card>
    </AppShell>
  );
}
