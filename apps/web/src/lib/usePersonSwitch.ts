'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FamilyChild } from '@yenisey/types';
import { api } from './api';
import { canBeGuardianBirthDate, isChildBirthDate } from './family';
import { useSession } from './useSession';

/**
 * За кого действует вошедший — за себя или за своего ребёнка младше 16.
 *
 * Выбор живёт в адресе (`?for=<id>`): страница клуба, бронь стола и «Мои
 * записи» открываются уже с выбранным ребёнком, и ссылку из «Моих детей» можно
 * просто открыть. Читается из `window.location` в эффекте, а не через
 * `useSearchParams`: тому на каждой странице нужна граница Suspense.
 *
 * Идентификатор из адреса, которого нет среди детей вошедшего, молча
 * игнорируется: чужой ребёнок в адресе — не повод действовать за него, и
 * сервер всё равно ответил бы отказом.
 */
export function usePersonSwitch() {
  const session = useSession();
  const user = session.status === 'ready' ? session.user : null;

  const [children, setChildren] = useState<FamilyChild[]>([]);
  const [requested, setRequested] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setRequested(new URLSearchParams(window.location.search).get('for'));
  }, []);

  const userId = user?.id ?? null;
  const guardianAge = user ? canBeGuardianBirthDate(user.birthDate) : false;

  useEffect(() => {
    if (!userId || !guardianAge) {
      setChildren([]);
      return;
    }

    api
      .myChildren()
      .then(setChildren)
      .catch(() => setChildren([]));
  }, [userId, guardianAge, version]);

  /** Состав семьи поменялся — перечитать детей. */
  const reload = useCallback(() => setVersion((value) => value + 1), []);

  const choose = useCallback((id: string | null) => {
    setRequested(id);

    const url = new URL(window.location.href);
    if (id) url.searchParams.set('for', id);
    else url.searchParams.delete('for');
    window.history.replaceState(null, '', url);
  }, []);

  const selected = children.find((child) => child.id === requested) ?? null;

  return {
    /** Дети, которых вошедший ведёт. Пусто — переключатель не нужен. */
    children,
    /** Выбранный ребёнок или никто — тогда вошедший действует сам. */
    selected,
    /** Идентификатор для запросов: `?for=` или ничего. */
    forPerson: selected?.id ?? null,
    choose,
    reload,
    /** Вошедшему нет 16 и он действует сам: менять ничего не может. */
    selfIsChild: user !== null && selected === null && isChildBirthDate(user.birthDate),
  };
}
