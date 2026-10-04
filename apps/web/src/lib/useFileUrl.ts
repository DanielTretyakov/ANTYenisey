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

/** Уже скачанные открытые файлы: id → `blob:`-адрес на всё время жизни вкладки. */
const sharedResolved = new Map<string, string>();
const sharedPending = new Map<string, Promise<string | null>>();

/**
 * То же для ОТКРЫТОГО неизменного файла — логотипа клуба: один `blob:`-адрес на
 * вкладку, а не по запросу на каждый показ. На стартовой знак одного клуба
 * стоит в плитке, в «Моих клубах» и в ленте, и без памяти скачивался бы
 * трижды.
 *
 * Память безопасна, потому что файл не меняется: новая загрузка — новый id.
 * Только для открытых файлов: аватар ребёнка, однажды показанный одному
 * человеку, из памяти вкладки достался бы следующему, вошедшему в ней же.
 */
export function useSharedFileUrl(fileId: string | null): string | null {
  const [url, setUrl] = useState<string | null>(() => (fileId ? (sharedResolved.get(fileId) ?? null) : null));

  useEffect(() => {
    if (!fileId) {
      setUrl(null);
      return;
    }

    const ready = sharedResolved.get(fileId);

    if (ready) {
      setUrl(ready);
      return;
    }

    let cancelled = false;
    let pending = sharedPending.get(fileId);

    if (!pending) {
      pending = api
        .file(fileId)
        .then((blob) => {
          const created = URL.createObjectURL(blob);
          sharedResolved.set(fileId, created);
          return created;
        })
        .catch(() => null)
        .finally(() => sharedPending.delete(fileId));
      sharedPending.set(fileId, pending);
    }

    void pending.then((value) => {
      if (!cancelled) setUrl(value);
    });

    return () => {
      cancelled = true;
    };
  }, [fileId]);

  return url;
}
