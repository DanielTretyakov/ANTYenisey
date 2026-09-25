'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * Адрес загруженного файла для `<img src>` — локальный, из байтов.
 *
 * Не адрес API напрямую: картинка по адресу уходит без токена, а аватар
 * игрока младше четырнадцати и скан приказа отдаются только тем, кому можно.
 * Байты читаются от имени вошедшего, а наружу отдаётся `blob:`-адрес, который
 * снимается, когда файл больше не нужен.
 *
 * Пока файл не пришёл или его не отдали — null: показывается заглушка.
 */
export function useFileUrl(fileId: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!fileId) {
      setUrl(null);
      return;
    }

    let cancelled = false;
    let created: string | null = null;

    api
      .file(fileId)
      .then((blob) => {
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [fileId]);

  return url;
}
