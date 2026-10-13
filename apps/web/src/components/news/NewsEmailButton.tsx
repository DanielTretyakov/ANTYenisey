'use client';

import { useEffect, useState } from 'react';
import type { NewsEmailInfo, NewsItem } from '@yenisey/types';
import { Button } from '@/components/ui/Button';
import { api, ApiError } from '@/lib/api';
import { useMailEnabled } from '@/lib/mailStatus';
import { plural } from '@/lib/plural';

/**
 * «Отправить письмом» у опубликованной новости (решения владельца от
 * 12.10.2026): сначала число получателей, потом подтверждение; разослать
 * можно один раз. Получатели — согласившиеся на новости с подтверждённой
 * почтой; «Для клубов» — сотрудники клубов и заявители с согласием.
 */
export function NewsEmailButton({ item }: { item: NewsItem }) {
  const mailEnabled = useMailEnabled();
  const [info, setInfo] = useState<NewsEmailInfo | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInfo(null);
    setConfirming(false);
    setError(null);

    if (!mailEnabled || !item.publishedAt) return;

    api
      .newsEmailInfo(item.id)
      .then(setInfo)
      .catch(() => setInfo(null));
  }, [item.id, item.publishedAt, mailEnabled]);

  if (!mailEnabled || !item.publishedAt || !info) {
    return null;
  }

  if (info.emailedAt) {
    return (
      <p className="text-[0.875rem] text-text-muted">
        Разослана письмом {new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(info.emailedAt))}.
      </p>
    );
  }

  async function send(): Promise<void> {
    setPending(true);
    setError(null);

    try {
      setInfo(await api.emailNews(item.id));
      setConfirming(false);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setPending(false);
    }
  }

  const who = `${info.recipients} ${plural(info.recipients, 'получатель', 'получателя', 'получателей')}`;

  return (
    <div className="flex flex-wrap items-center gap-2 text-[0.875rem]">
      {confirming ? (
        <>
          <span className="text-text-muted">Разослать письмом — {who}? Повторить нельзя.</span>
          <Button size="sm" pending={pending} disabled={info.recipients === 0} onClick={() => void send()}>
            Да, разослать
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Отмена
          </Button>
        </>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
          Отправить письмом · {who}
        </Button>
      )}
      {error && <span className="text-danger">{error}</span>}
    </div>
  );
}
