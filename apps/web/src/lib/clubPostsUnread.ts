'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ClubPostsUnread } from '@yenisey/types';
import { api } from '@/lib/api';
import { useSession } from '@/lib/useSession';

/**
 * Непрочитанное в лентах моих клубов (решение владельца от 30.09.2026) —
 * шапка и карточки клубов на стартовой.
 *
 * Прочтение случается в окне новостей клуба, а счётчик живёт в шапке — другом
 * компоненте. Связь — событием окна: окно новостей объявляет «прочитано»,
 * счётчики перечитываются сами. Иначе шапка горела бы до перезагрузки.
 */
const READ_EVENT = 'yenisey:club-posts-read';

export function announcePostsRead(): void {
  window.dispatchEvent(new Event(READ_EVENT));
}

export function useClubPostsUnread(): ClubPostsUnread | null {
  const session = useSession();
  const [unread, setUnread] = useState<ClubPostsUnread | null>(null);
  const ready = session.status === 'ready';

  const load = useCallback(() => {
    api
      .clubPostsUnread()
      .then(setUnread)
      .catch(() => setUnread(null));
  }, []);

  useEffect(() => {
    if (!ready) {
      setUnread(null);
      return;
    }

    load();
    window.addEventListener(READ_EVENT, load);
    // Вернулся на вкладку — клуб мог опубликовать что-то новое.
    window.addEventListener('focus', load);

    return () => {
      window.removeEventListener(READ_EVENT, load);
      window.removeEventListener('focus', load);
    };
  }, [ready, load]);

  return unread;
}
