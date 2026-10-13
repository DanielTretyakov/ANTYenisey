'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

let cached: Promise<boolean> | null = null;

/**
 * Работает ли почта сервиса (12.10.2026). Пока провайдер не подключён,
 * «Забыли пароль?» и «подтвердите почту» не предлагаются: письмо не придёт.
 * Запрос один на вкладку.
 */
export function useMailEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    cached ??= api
      .mailStatus()
      .then((status) => status.enabled)
      .catch(() => false);

    let alive = true;
    void cached.then((value) => {
      if (alive) setEnabled(value);
    });

    return () => {
      alive = false;
    };
  }, []);

  return enabled;
}
