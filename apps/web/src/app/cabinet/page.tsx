'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { PublicUser, Role } from '@yenisey/types';
import { api, ApiError } from '@/lib/api';
import { clearSession, readAccessToken, readRefreshToken, saveSession } from '@/lib/session';

const ROLE_LABELS: Record<Role, string> = {
  CLIENT: 'Клиент',
  COACH: 'Тренер',
  ADMIN: 'Администратор',
  OWNER: 'Руководство клуба',
};

export default function CabinetPage() {
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      const accessToken = readAccessToken();

      if (!accessToken) {
        router.replace('/login');
        return;
      }

      try {
        const profile = await api.me(accessToken);
        if (!cancelled) setUser(profile);
      } catch (cause) {
        // Access живёт 15 минут, refresh — 30 дней: истёкший короткий токен
        // это штатное состояние, а не повод выкидывать клиента на форму входа.
        if (cause instanceof ApiError && cause.status === 401) {
          const refreshed = await tryRefresh();
          if (!cancelled && refreshed) {
            setUser(refreshed);
            return;
          }
          if (!cancelled) router.replace('/login');
          return;
        }

        if (!cancelled) {
          setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleLogout(): Promise<void> {
    const refreshToken = readRefreshToken();

    // Токен гасится на сервере, а не только стирается локально: иначе украденная
    // копия осталась бы рабочей все 30 дней после «выхода».
    if (refreshToken) {
      await api.logout(refreshToken).catch(() => undefined);
    }

    clearSession();
    router.replace('/login');
  }

  if (error) {
    return (
      <main>
        <h1>Личный кабинет</h1>
        <p className="error">{error}</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main>
        <h1>Личный кабинет</h1>
        <p className="hint">Загружаю…</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Личный кабинет</h1>

      <dl>
        <dt>ФИО</dt>
        <dd>{user.fullName ?? '—'}</dd>

        <dt>Электронная почта</dt>
        <dd>{user.email}</dd>

        <dt>Телефон</dt>
        <dd>{user.phone ?? '—'}</dd>

        <dt>Роль</dt>
        <dd>{ROLE_LABELS[user.role]}</dd>
      </dl>

      <button type="button" onClick={() => void handleLogout()}>
        Выйти
      </button>
    </main>
  );
}

/** Обновление пары токенов. Возвращает профиль или null, если сессия мертва. */
async function tryRefresh(): Promise<PublicUser | null> {
  const refreshToken = readRefreshToken();

  if (!refreshToken) {
    return null;
  }

  try {
    const auth = await api.refresh(refreshToken);
    saveSession(auth);
    return auth.user;
  } catch {
    clearSession();
    return null;
  }
}
