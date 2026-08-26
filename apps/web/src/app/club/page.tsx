'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type {
  ClubCoach,
  ClubSettings,
  ClubTable,
  Hall,
  Role,
  Tournament,
  TournamentType,
  TrainingType,
} from '@yenisey/types';
import { AppShell } from '@/components/layout/AppShell';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/useSession';
import { HallForm } from './HallForm';
import { ScheduleCard } from './ScheduleCard';
import { SettingsForm } from './SettingsForm';
import { TablesCard } from './TablesCard';

/** Роли, которым доступен профиль клуба. */
const CLUB_MANAGERS: Role[] = ['ADMIN', 'OWNER'];

type Loaded = {
  settings: ClubSettings;
  halls: Hall[];
  tables: ClubTable[];
  coaches: ClubCoach[];
  trainingTypes: TrainingType[];
  tournamentTypes: TournamentType[];
  tournaments: Tournament[];
};

/**
 * Настройки клуба: общие правила, залы, столы и расписание.
 *
 * Проверка роли здесь — это удобство, а не защита: она убирает со страницы то,
 * чем человек всё равно не сможет воспользоваться. Настоящий запрет стоит на
 * API (`@Roles('ADMIN', 'OWNER')`), и обойти его, открыв адрес напрямую,
 * нельзя.
 */
export default function ClubPage() {
  const session = useSession();
  const router = useRouter();

  const [data, setData] = useState<Loaded | null>(null);
  const [hallId, setHallId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingHall, setAddingHall] = useState(false);

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

    // Всё грузится разом: это один экран, и ждать части по очереди означало бы
    // умножить ожидание на ровном месте.
    Promise.all([
      api.clubSettings(),
      api.halls(),
      api.clubTables(),
      api.coaches(),
      api.trainingTypes(),
      api.tournamentTypes(),
      api.tournaments(),
    ])
      .then(([settings, halls, tables, coaches, trainingTypes, tournamentTypes, tournaments]) => {
        if (cancelled) return;

        // В сетку предлагаются только действующие типы: снятый с продажи не
        // должен появляться в новых окнах, хотя в старых он остаётся.
        setData({
          settings,
          halls,
          tables,
          coaches,
          trainingTypes: trainingTypes.filter((type) => type.isActive),
          tournamentTypes: tournamentTypes.filter((type) => type.isActive),
          tournaments,
        });
        setHallId((previous) => previous ?? halls[0]?.id ?? null);
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

  const hall = data?.halls.find((item) => item.id === hallId) ?? null;

  async function addHall(): Promise<void> {
    if (!data) return;

    setError(null);
    setAddingHall(true);

    try {
      // Новый зал заводится с настройками текущего: второй зал клуба обычно
      // похож на первый, и переписывать цены с нуля незачем.
      const source = hall ?? data.halls[0];
      const created = await api.createHall({
        name: nextHallName(data.halls),
        bookingStep: source?.bookingStep ?? 'MIN_30',
        tableHourPrice: source?.tableHourPrice ?? 0,
        tableExtra30MinPrice: source?.tableExtra30MinPrice ?? 0,
        hasRobotOption: false,
        robot30MinPrice: null,
        robot60MinPrice: null,
        robotExtra30MinPrice: null,
      });

      setData({ ...data, halls: [...data.halls, created].sort(byName) });
      setHallId(created.id);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
    } finally {
      setAddingHall(false);
    }
  }

  return (
    <AppShell>
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
          <SettingsForm
            initial={data.settings}
            onSaved={(settings) => setData({ ...data, settings })}
          />

          <div>
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[0.8125rem] tracking-[0.06em] text-text-subtle uppercase">
                Залы
              </span>

              {data.halls.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={item.id === hallId}
                  onClick={() => setHallId(item.id)}
                  className={cn(
                    'rounded-control border px-3.5 py-1.5 text-[0.875rem] transition-colors',
                    item.id === hallId
                      ? 'border-border-accent bg-surface-accent-soft text-text-accent'
                      : 'border-border text-text-muted hover:bg-surface-sunken',
                  )}
                >
                  {item.name}
                </button>
              ))}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                pending={addingHall}
                onClick={() => void addHall()}
              >
                + Зал
              </Button>
            </div>

            {hall && (
              <div className="grid gap-6">
                <HallForm
                  hall={hall}
                  canDelete={data.halls.length > 1}
                  onSaved={(updated) =>
                    setData({
                      ...data,
                      halls: data.halls.map((item) => (item.id === updated.id ? updated : item)),
                    })
                  }
                  onDeleted={(removed) => {
                    const halls = data.halls.filter((item) => item.id !== removed);
                    setData({ ...data, halls });
                    setHallId(halls[0]?.id ?? null);
                  }}
                />

                <TablesCard
                  hallId={hall.id}
                  tables={data.tables}
                  onChange={(tables) => setData({ ...data, tables })}
                />

                <ScheduleCard
                  // Смена зала должна полностью пересобрать сетку: иначе в новом
                  // зале останутся клетки предыдущего.
                  key={hall.id}
                  hallId={hall.id}
                  tables={data.tables}
                  coaches={data.coaches}
                  trainingTypes={data.trainingTypes}
                  tournamentTypes={data.tournamentTypes}
                  tournaments={data.tournaments}
                  timezone={data.settings.timezone}
                  // Постановка турнира в сетку заводит его: список в разделе
                  // «Занятия и турниры» после этого устарел.
                  onTournamentsChanged={() => {
                    void api.tournaments().then((tournaments) =>
                      setData((previous) => (previous ? { ...previous, tournaments } : previous)),
                    );
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}

/** Следующее свободное имя вида «Зал 2». */
function nextHallName(halls: Hall[]): string {
  const taken = new Set(halls.map((hall) => hall.name));

  for (let index = 2; ; index += 1) {
    const name = `Зал ${index}`;

    if (!taken.has(name)) {
      return name;
    }
  }
}

const byName = (a: Hall, b: Hall): number => a.name.localeCompare(b.name, 'ru');

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
