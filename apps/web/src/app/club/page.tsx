'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ClubClosures, ClubSettings, ClubTable, Role } from '@yenisey/types';
import { AppShell } from '@/components/layout/AppShell';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/useSession';
import { ClosuresCard } from './ClosuresCard';
import { ExceptionsCard } from './ExceptionsCard';
import { SettingsForm } from './SettingsForm';
import { TablesCard } from './TablesCard';

/** Роли, которым доступен профиль клуба. */
const CLUB_MANAGERS: Role[] = ['ADMIN', 'OWNER'];

/**
 * Настройки клуба: цены, шаг бронирования, столы, правила присутствия.
 *
 * Проверка роли здесь — это удобство, а не защита: она убирает со страницы то,
 * чем человек всё равно не сможет воспользоваться. Настоящий запрет стоит на
 * API (`@Roles('ADMIN', 'OWNER')`), и обойти его, открыв адрес напрямую,
 * нельзя.
 */
export default function ClubPage() {
  const session = useSession();
  const router = useRouter();

  const [data, setData] = useState<{
    settings: ClubSettings;
    tables: ClubTable[];
    closures: ClubClosures;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allowed = session.status === 'ready' && CLUB_MANAGERS.includes(session.user.role);

  useEffect(() => {
    if (session.status === 'anonymous') {
      router.replace('/login');
    }
  }, [session.status, router]);

  useEffect(() => {
    if (!allowed) {
      return;
    }

    let cancelled = false;

    // Настройки и столы грузятся разом: они показываются на одном экране, и
    // ждать их по очереди означало бы удвоить ожидание на ровном месте.
    Promise.all([api.clubSettings(), api.clubTables(), api.clubClosures()])
      .then(([settings, tables, closures]) => {
        if (!cancelled) setData({ settings, tables, closures });
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [allowed]);

  return (
    <AppShell
      actions={
        <Link href="/cabinet">
          <Button variant="ghost" size="sm">
            В кабинет
          </Button>
        </Link>
      }
    >
      <h1 className="mb-2 text-[1.75rem]">Настройки клуба</h1>
      <p className="mb-7 max-w-2xl text-[0.9375rem] text-text-muted">
        Всё на этой странице клуб меняет сам, без участия разработчика. Изменения
        касаются новых броней: уже созданные хранят свою копию цены, и правка прайса
        не переписывает историю задним числом.
      </p>

      {session.status === 'ready' && !allowed && (
        <Alert>Раздел доступен только администратору и руководству клуба.</Alert>
      )}

      {error && <Alert>{error}</Alert>}

      {allowed && !error && !data && <SettingsSkeleton />}

      {data && (
        <div className="grid gap-6">
          <SettingsForm initial={data.settings} />
          <TablesCard initial={data.tables} />
          <ClosuresCard tables={data.tables} initial={data.closures.rules} />
          <ExceptionsCard
            tables={data.tables}
            initial={data.closures.exceptions}
            timezone={data.settings.timezone}
          />
        </div>
      )}
    </AppShell>
  );
}

/**
 * Заглушка на время загрузки.
 *
 * Серые полосы вместо надписи «Загружаю…»: они занимают то место, куда встанут
 * поля, и страница не подпрыгивает в момент ответа сервера.
 */
function SettingsSkeleton() {
  return (
    <Card aria-busy="true">
      <CardHeader title="Клуб" description="Загружаю настройки…" />
      <CardBody>
        <div className="grid gap-5">
          {[0, 1, 2, 3].map((index) => (
            <div key={index}>
              <div className="h-2.5 w-32 rounded-full bg-border" />
              <div className="mt-2.5 h-10 w-full rounded-control bg-border/60" />
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
