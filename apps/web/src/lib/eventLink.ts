'use client';

import { useEffect, useState } from 'react';
import type { EventKind } from '@yenisey/types';
import { loginHref } from './next';

/** Параметр адреса, по которому страница сама открывает окно мероприятия. */
const PARAM = 'event';

export interface EventRef {
  kind: EventKind;
  id: string;
}

/**
 * «Войти и записаться» у конкретного мероприятия — вход с возвратом в его же
 * окно (`?event=TRAINING:<id>`). Раньше возвращало на верх страницы клуба, и
 * новичок после регистрации искал свою тренировку в расписании заново.
 */
export function loginToEventHref(kind: EventKind, id: string): string {
  if (typeof window === 'undefined') return loginHref();

  const params = new URLSearchParams(window.location.search);
  params.set(PARAM, `${kind}:${id}`);

  return loginHref(`${window.location.pathname}?${params.toString()}${window.location.hash}`);
}

/**
 * Мероприятие из адреса — один раз: параметр тут же снимается, чтобы
 * перезагрузка или «Назад» не открывали окно снова.
 */
export function useEventFromUrl(): [EventRef | null, () => void] {
  const [event, setEvent] = useState<EventRef | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const parsed = parseEventParam(params.get(PARAM));
    if (!parsed) return;

    params.delete(PARAM);
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
    );
    setEvent(parsed);
  }, []);

  return [event, () => setEvent(null)];
}

export function parseEventParam(value: string | null): EventRef | null {
  const match = value?.match(/^(TRAINING|TOURNAMENT):([A-Za-z0-9_-]{1,64})$/);

  return match ? { kind: match[1] as EventKind, id: match[2]! } : null;
}
