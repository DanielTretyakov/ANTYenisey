'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { PublicUser, Role } from '@yenisey/types';
import { AppShell } from '@/components/layout/AppShell';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { api, ApiError } from '@/lib/api';
import { clearSession, readAccessToken, saveSession } from '@/lib/session';

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

      // Access-токен живёт только в памяти вкладки, поэтому после
      // перезагрузки страницы его нет — это норма, а не выход из системы.
      // Сессию восстанавливаем обменом httpOnly-куки с refresh-токеном.
      if (!accessToken) {
        const restored = await tryRefresh();
        if (cancelled) return;
        if (restored) {
          setUser(restored);
        } else {
          router.replace('/login');
        }
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
    // Токен гасится на сервере, а не только стирается локально: иначе
    // украденная копия осталась бы рабочей все 30 дней после «выхода». Сервер
    // же стирает и куку — из браузера её этому коду не достать.
    await api.logout().catch(() => undefined);

    clearSession();
    router.replace('/login');
  }

  return (
    <AppShell
      actions={
        user ? (
          <Button variant="ghost" size="sm" onClick={() => void handleLogout()}>
            Выйти
          </Button>
        ) : null
      }
    >
      <h1 className="mb-7 text-[1.75rem]">Личный кабинет</h1>

      {error && <Alert>{error}</Alert>}

      {!error && !user && <ProfileSkeleton />}

      {user && (
        <Card className="max-w-2xl">
          <CardHeader title="Профиль" description="Данные, которые видит администратор клуба." />
          <CardBody>
            <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <Row label="ФИО" value={user.fullName ?? '—'} />
              <Row label="Электронная почта" value={user.email} />
              <Row label="Телефон" value={user.phone ?? '—'} />
              <Row label="Роль" value={ROLE_LABELS[user.role]} />
            </dl>
          </CardBody>
        </Card>
      )}
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.75rem] tracking-[0.1em] text-text-subtle uppercase">{label}</dt>
      <dd className="mt-1 text-[0.9375rem] text-text">{value}</dd>
    </div>
  );
}

/**
 * Заглушка на время загрузки профиля.
 *
 * Серые полосы вместо надписи «Загружаю…»: они занимают ровно то место, куда
 * встанут данные, и карточка не подпрыгивает в момент ответа сервера.
 */
function ProfileSkeleton() {
  return (
    <Card className="max-w-2xl" aria-busy="true">
      <CardHeader title="Профиль" description="Загружаю данные…" />
      <CardBody>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {[0, 1, 2, 3].map((index) => (
            <div key={index}>
              <div className="h-2.5 w-24 rounded-full bg-border" />
              <div className="mt-2.5 h-3.5 w-40 rounded-full bg-border" />
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * Обновление пары токенов. Возвращает профиль или null, если сессия мертва.
 *
 * Refresh-токен не передаётся: он в httpOnly-куке, и браузер приложит её сам.
 * Поэтому проверить наличие сессии заранее нельзя — остаётся спросить сервер.
 */
async function tryRefresh(): Promise<PublicUser | null> {
  try {
    const auth = await api.refresh();
    saveSession(auth);
    return auth.user;
  } catch {
    clearSession();
    return null;
  }
}
