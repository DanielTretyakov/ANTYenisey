'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { PublicUser, Role } from '@yenisey/types';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { api } from '@/lib/api';
import { clearSession } from '@/lib/session';
import { useSession } from '@/lib/useSession';

const ROLE_LABELS: Record<Role, string> = {
  CLIENT: 'Клиент',
  COACH: 'Тренер',
  ADMIN: 'Администратор',
  OWNER: 'Руководство клуба',
};

/** Роли, которым доступен профиль клуба. */
const CLUB_MANAGERS: Role[] = ['ADMIN', 'OWNER'];

export default function CabinetPage() {
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    if (session.status === 'anonymous') {
      router.replace('/login');
    }
  }, [session.status, router]);

  async function handleLogout(): Promise<void> {
    // Токен гасится на сервере, а не только стирается локально: иначе
    // украденная копия осталась бы рабочей все 30 дней после «выхода». Сервер
    // же стирает и куку — из браузера её этому коду не достать.
    await api.logout().catch(() => undefined);

    clearSession();
    router.replace('/login');
  }

  const user = session.status === 'ready' ? session.user : null;

  return (
    <AppShell
      actions={
        user ? (
          <>
            {CLUB_MANAGERS.includes(user.role) && (
              <Link href="/club">
                <Button variant="ghost" size="sm">
                  Настройки клуба
                </Button>
              </Link>
            )}
            <Button variant="ghost" size="sm" onClick={() => void handleLogout()}>
              Выйти
            </Button>
          </>
        ) : null
      }
    >
      <h1 className="mb-7 text-[1.75rem]">Личный кабинет</h1>

      {user ? <Profile user={user} /> : <ProfileSkeleton />}
    </AppShell>
  );
}

function Profile({ user }: { user: PublicUser }) {
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Профиль" description="Данные, которые видит администратор клуба." />
      <CardBody>
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <Row label="ФИО" value={user.fullName} />
          <Row label="Электронная почта" value={user.email} />
          <Row label="Телефон" value={user.phone ?? '—'} />
          <Row label="Роль" value={ROLE_LABELS[user.role]} />
        </dl>
      </CardBody>
    </Card>
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
