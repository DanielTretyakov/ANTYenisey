'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type {
  ClubCoach,
  ClubTable,
  Hall,
  Role,
  Tournament,
  TournamentType,
  TrainingType,
} from '@yenisey/types';
import { AdminShell } from '@/components/layout/AdminShell';
import { Alert } from '@/components/ui/Alert';
import { Tab } from '@/components/ui/Tab';
import { roleInClub } from '@/lib/membership';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { useSession } from '@/lib/useSession';
import { DayBoard } from './DayBoard';
import { messageOf, TemplateBoard } from './TemplateBoard';
import { initialHallId, PreferredHallButton, usePreferredHall, withPreferredFirst } from '@/components/club/PreferredHall';

const MANAGERS: Role[] = ['ADMIN', 'OWNER'];

type Mode = 'day' | 'template';

interface Loaded {
  halls: Hall[];
  tables: ClubTable[];
  coaches: ClubCoach[];
  trainingTypes: TrainingType[];
  tournamentTypes: TournamentType[];
  tournaments: Tournament[];
}

/**
 * Расписание зала — раздел операционки.
 *
 * Раньше сетка жила карточкой на странице настроек, рядом с ценами, которые
 * меняют раз в сезон. Расписание же правят каждый вечер — переносят занятие,
 * закрывают стол под ремонт, — и держать его там значило гонять администратора
 * через раздел, который ему в смену не нужен. Шаблон недели переехал сюда же:
 * всё расписание в одном месте, и не приходится помнить, в каком разделе что.
 *
 * Открывается на «Дне», а не на шаблоне: сегодняшний день правят чаще, чем
 * устройство недели.
 */
export default function SchedulePage() {
  const session = useSession();
  const router = useRouter();
  const slug = useClubSlug();
  const club = useClubApi();

  const role = session.status === 'ready' ? roleInClub(session.user, slug) : null;
  const allowed = role !== null && MANAGERS.includes(role);

  const [data, setData] = useState<Loaded | null>(null);
  const [hallId, setHallId] = useState('');
  const [mode, setMode] = useState<Mode>('day');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.status === 'anonymous') router.replace('/login');
  }, [session.status, router]);

  useEffect(() => {
    if (!allowed) return;

    let cancelled = false;

    // Одним запросом на всё, что нужно сетке: палитре — тренеры и типы,
    // подписям окон — турниры. В палитру идут только действующие типы: снятое
    // с продажи в новое расписание не ставится.
    Promise.all([
      club.halls(),
      club.clubTables(),
      club.coaches(),
      club.trainingTypes(),
      club.tournamentTypes(),
      club.tournaments(),
    ])
      .then(([halls, tables, coaches, trainingTypes, tournamentTypes, tournaments]) => {
        if (cancelled) return;

        setData({
          halls,
          tables,
          coaches,
          trainingTypes: trainingTypes.filter((type) => type.isActive),
          tournamentTypes: tournamentTypes.filter((type) => type.isActive),
          tournaments,
        });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageOf(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [allowed, club]);

  const preferred = usePreferredHall();

  // Зал по умолчанию — приоритетный, как только известны и залы, и выбор.
  useEffect(() => {
    if (!data || !preferred.ready) return;
    setHallId((current) => current || initialHallId(data.halls, preferred.preferredHallId));
  }, [data, preferred.ready, preferred.preferredHallId]);

  const hall = data?.halls.find((item) => item.id === hallId) ?? null;

  const refreshTournaments = (): void => {
    void club
      .tournaments()
      .then((tournaments) =>
        setData((previous) => (previous ? { ...previous, tournaments } : previous)),
      );
  };

  return (
    <AdminShell wide>
      <header className="mb-5 max-w-2xl">
        <h1 className="text-[1.75rem]">Расписание</h1>
        <p className="mt-1.5 text-[0.9375rem] text-text-muted">
          Закрашенное время клиент не увидит в сетке брони и занять не сможет. Администратор —
          сможет: жизнь в зале всегда сложнее расписания.
        </p>
      </header>

      {session.status === 'ready' && !allowed && (
        <Alert>Раздел доступен только администратору и руководству клуба.</Alert>
      )}

      {error && <Alert>{error}</Alert>}

      {allowed && !data && !error && (
        <div className="h-[32rem] animate-pulse rounded-card border border-border bg-surface-raised" />
      )}

      {data && data.halls.length === 0 && (
        <p className="text-[0.9375rem] text-text-muted">
          В клубе пока нет залов. Заведите зал и столы в разделе «Настройки».
        </p>
      )}

      {data && hall && (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3">
            {data.halls.length > 1 && (
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Зал">
                {withPreferredFirst(data.halls, preferred.preferredHallId).map((item) => (
                  <Tab
                    key={item.id}
                    inTablist
                    active={item.id === hallId}
                    onClick={() => setHallId(item.id)}
                  >
                    {item.name}
                  </Tab>
                ))}
                <PreferredHallButton
                  hallId={hallId}
                  preferredHallId={preferred.preferredHallId}
                  pending={preferred.pending}
                  onToggle={(id) => void preferred.toggle(id)}
                />
              </div>
            )}

            <div className="flex gap-1.5" role="tablist" aria-label="Режим расписания">
              <Tab inTablist active={mode === 'day'} onClick={() => setMode('day')}>
                День
              </Tab>
              <Tab inTablist active={mode === 'template'} onClick={() => setMode('template')}>
                Шаблон недели
              </Tab>
            </div>
          </div>

          <section className="rounded-card border border-border bg-surface-raised px-4 py-5 shadow-sm sm:px-6">
            {mode === 'day' ? (
              <DayBoard
                // Смена зала пересоздаёт сетку целиком: состояние прошлого зала,
                // оставшееся на экране, читалось бы как расписание нового.
                key={hall.id}
                hallId={hall.id}
                timezone={hall.timezone}
                tables={data.tables}
                coaches={data.coaches}
                trainingTypes={data.trainingTypes}
                tournamentTypes={data.tournamentTypes}
                tournaments={data.tournaments}
                onTournamentsChanged={refreshTournaments}
              />
            ) : (
              <TemplateBoard
                key={hall.id}
                hallId={hall.id}
                tables={data.tables}
                coaches={data.coaches}
                trainingTypes={data.trainingTypes}
                tournamentTypes={data.tournamentTypes}
                tournaments={data.tournaments}
              />
            )}
          </section>
        </>
      )}
    </AdminShell>
  );
}
