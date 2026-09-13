'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';

/**
 * Открыть скан приказа в новой вкладке.
 *
 * Прямой ссылкой на API нельзя: она ушла бы без токена, а скан отдаётся только
 * владельцу и администраторам его клубов. Байты читаются от имени вошедшего и
 * открываются `blob:`-адресом.
 *
 * Вкладка открывается СРАЗУ, в обработчике нажатия, и только потом ждёт
 * файл: окно, открытое после `await`, браузер считает непрошеным и блокирует.
 */
export function DocumentButton({ fileId, label }: { fileId: string; label: string }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function open(): Promise<void> {
    const tab = window.open('', '_blank');
    setPending(true);
    setFailed(false);

    try {
      const url = URL.createObjectURL(await api.file(fileId));

      if (tab) {
        tab.location.href = url;
      } else {
        window.location.href = url;
      }

      // Вкладке хватит минуты, чтобы прочитать файл; дальше адрес не нужен.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      tab?.close();
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="secondary" pending={pending} onClick={() => void open()}>
        {label}
      </Button>
      {failed && <span className="text-[0.8125rem] text-warning">Не открылся</span>}
    </span>
  );
}
