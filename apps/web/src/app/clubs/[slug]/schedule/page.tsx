'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { hasAnyRole, MANAGING_ROLES, type ClubCoach, type ClubTable, type Hall, type TournamentType, type TrainingType } from '@yenisey/types';
import { AdminShell } from '@/components/layout/AdminShell';
import { Alert } from '@/components/ui/Alert';
import { CompactSelect } from '@/components/ui/CompactSelect';
import { Tab } from '@/components/ui/Tab';
import { rolesInClub } from '@/lib/membership';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { useSession } from '@/lib/useSession';
import { DayBoard } from './DayBoard';
import { messageOf, TemplateBoard } from './TemplateBoard';
import { useLeaveGuard } from './useLeaveGuard';
import { initialHallId, PreferredHallButton, usePreferredHall, withPreferredFirst } from '@/components/club/PreferredHall';


type Mode = 'day' | 'template';

interface Loaded {
  halls: Hall[];
  tables: ClubTable[];
  coaches: ClubCoach[];
  /** Все типы, и снятые с продажи: по ним подписаны уже стоящие окна. */
  trainingTypes: TrainingType[];
  tournamentTypes: TournamentType[];
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
 *
 * Зал выбирается списком, а не рядом кнопок (решение от 05.10.2026): у
 * организации залов бывает много, и ряд кнопок переносился на вторую и третью
 * строку, отодвигая сетку вниз.
 */
export default function SchedulePage() {
  const session = useSession();
  const router = useRouter();
  const slug = useClubSlug();
  const club = useClubApi();

  const roles = session.status === 'ready' ? rolesInClub(session.user, slug) : [];
  const allowed = hasAnyRole(roles, MANAGING_ROLES);

  const [data, setData] = useState<Loaded | null>(null);
  const [hallId, setHallId] = useState('');
  const [mode, setMode] = useState<Mode>('day');
  const [error, setError] = useState<string | null>(null);
  /** Несохранённые правки открытой сетки — смена зала и режима их не выбросит молча. */
  const [dirty, setDirty] = useState(false);
  const leave = useLeaveGuard(dirty);
  const onDirtyChange = useCallback((next: boolean) => setDirty(next), []);

  useEffect(() => {
    if (session.status === 'anonymous') router.replace('/login');
  }, [session.status, router]);

  useEffect(() => {
    if (!allowed) return;

    let cancelled = false;

    // Одним запросом на всё, что нужно сетке: палитре — тренеры и типы. Типы
    // — все, и снятые с продажи: в палитру хук пустит только действующие, а
    // подписать уже стоящее окно нужно и снятым. Все турниры клуба за всю
    // историю сетке больше не нужны: тип турнира приходит в самом окне дня.
    Promise.all([club.halls(), club.clubTables(), club.coaches(), club.trainingTypes(), club.tournamentTypes()])
      .then(([halls, tables, coaches, trainingTypes, tournamentTypes]) => {
        if (cancelled) return;

        setData({ halls, tables, coaches, trainingTypes, tournamentTypes });
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

  return (
    <AdminShell wide>
      <header className="mb-5 max-w-2xl">
        {/* Название — как в меню (решение от 26.09.2026): раздел переименован
            в «Расписание залов», а заголовок страницы оставался прежним. */}
        <h1 className="text-[1.75rem]">Расписание залов</h1>
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
            {/* Зал — списком на любом экране (решение от 05.10.2026): залов у
                организации бывает много. Приоритетный — первым, звезда
                «Открывать первым» — кнопкой рядом. */}
            {data.halls.length > 1 && (
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <CompactSelect
                  label="Зал"
                  value={hallId}
                  options={withPreferredFirst(data.halls, preferred.preferredHallId).map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                  onChange={(next) => leave.guard(() => setHallId(next))}
                  className="min-w-[13rem] grow sm:w-[18rem] sm:grow-0"
                />
                <PreferredHallButton
                  hallId={hallId}
                  preferredHallId={preferred.preferredHallId}
                  pending={preferred.pending}
                  onToggle={(id) => void preferred.toggle(id)}
                />
              </div>
            )}

            <div className="flex gap-1.5" role="tablist" aria-label="Режим расписания">
              <Tab inTablist active={mode === 'day'} onClick={() => leave.guard(() => setMode('day'))}>
                День
              </Tab>
              <Tab inTablist active={mode === 'template'} onClick={() => leave.guard(() => setMode('template'))}>
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
                onDirtyChange={onDirtyChange}
                guard={leave.guard}
              />
            ) : (
              <TemplateBoard
                key={hall.id}
                hallId={hall.id}
                tables={data.tables}
                coaches={data.coaches}
                trainingTypes={data.trainingTypes}
                tournamentTypes={data.tournamentTypes}
                onDirtyChange={onDirtyChange}
              />
            )}
          </section>

          {leave.dialog}
        </>
      )}
    </AdminShell>
  );
}
