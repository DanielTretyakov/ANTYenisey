'use client';

import { useEffect, useState } from 'react';
import type { PublicUser } from '@yenisey/types';
import { api } from './api';

/**
 * Состояние сессии на странице.
 *
 * `loading` — первый ответ сервера ещё не пришёл. Отдельное состояние нужно,
 * чтобы не мигать формой входа тому, кто на самом деле вошёл: access-токен
 * живёт только в памяти вкладки, и сразу после перезагрузки его нет, хотя
 * сессия жива и восстановится обменом куки.
 */
export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'ready'; user: PublicUser };

/**
 * Кто сейчас на странице.
 *
 * Восстановлением сессии занимается сам клиент API (см. `authorized` в
 * lib/api.ts), поэтому здесь остаётся один запрос профиля: он либо отвечает,
 * либо означает, что входить нужно заново.
 */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    api
      .me()
      .then((user) => {
        if (!cancelled) setState({ status: 'ready', user });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'anonymous' });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
