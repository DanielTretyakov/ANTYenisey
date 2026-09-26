'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { hasAnyRole, LEADERSHIP_ROLES, shortName, type StaffCandidate, type StaffHall, type StaffSchedule } from '@yenisey/types';
import { AdminShell } from '@/components/layout/AdminShell';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { inputClassName } from '@/components/ui/Field';
import { Tab } from '@/components/ui/Tab';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { rolesInClub } from '@/lib/membership';
import { plural } from '@/lib/plural';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { useSession } from '@/lib/useSession';

function messageOf(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : 'Сервис недоступен';
}

/**
 * «Расписание персонала» (решение владельца от 26.09.2026): управляющий
 * назначает на каждый день своего зала одного или нескольких
 * администраторов, руководитель — в любом зале и ставит управляющих. Только
 * назначенным в этот день откроется «Смена», им же уходит сообщение в MAX.
 *
 * Сохраняется день целиком по нажатию на имя: смены правят по одной, и
 * отдельная кнопка «Сохранить» на три недели вперёд только копила бы правки,
 * о которых забывают.
 */
export default function StaffSchedulePage() {
  const session = useSession();
  const router = useRouter();
  const slug = useClubSlug();
  const club = useClubApi();

  const roles = session.status === 'ready' ? rolesInClub(session.user, slug) : [];
  const allowed = hasAnyRole(roles, LEADERSHIP_ROLES);
  const owner = roles.includes('OWNER');

  const [halls, setHalls] = useState<StaffHall[] | null>(null);
  const [managers, setManagers] = useState<StaffCandidate[]>([]);
  const [hallId, setHallId] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<StaffSchedule | null>(null);
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.status === 'anonymous') router.replace('/login');
  }, [session.status, router]);

  const loadHalls = useCallback(() => {
    club
      .staffHalls()
      .then((loaded) => {
        setHalls(loaded);
        setHallId((current) => current ?? loaded.find((hall) => hall.canPlan)?.id ?? null);
      })
      .catch((cause: unknown) => setError(messageOf(cause)));
  }, [club]);

  useEffect(() => {
    if (!allowed) return;
    loadHalls();
    if (owner) club.staffManagers().then(setManagers).catch(() => setManagers([]));
  }, [allowed, owner, club, loadHalls]);

  useEffect(() => {
    if (!hallId) return;

    let cancelled = false;
    setSchedule(null);

    club
      .staffSchedule(hallId)
      .then((loaded) => {
        if (!cancelled) setSchedule(loaded);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageOf(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [club, hallId]);

  async function toggle(date: string, adminId: string): Promise<void> {
    if (!schedule || !hallId) return;

    const current = schedule.days.find((day) => day.date === date)?.adminIds ?? [];
    const next = current.includes(adminId) ? current.filter((id) => id !== adminId) : [...current, adminId];

    setPendingDate(date);
    setError(null);

    try {
      setSchedule(await club.setStaffDay(hallId, date, next));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPendingDate(null);
    }
  }

  async function setManager(id: string, managerId: string | null): Promise<void> {
    setError(null);

    try {
      await club.setHallManager(id, managerId);
      loadHalls();
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  const hall = halls?.find((item) => item.id === hallId) ?? null;

  return (
    <AdminShell>
      <h1 className="mb-2 text-[1.75rem]">Расписание персонала</h1>
      <p className="mb-6 max-w-2xl text-[0.9375rem] text-text-muted">
        Кто из администраторов работает в зале в какой день. «Смена» откроется только назначенным — чтобы никто другой
        случайно ничего не внёс; им же придёт сообщение в MAX. Руководство работает на смене всегда.
      </p>

      {session.status === 'ready' && !allowed && (
        <Alert>Раздел доступен только руководству клуба — руководителю и управляющим.</Alert>
      )}

      {error && <Alert>{error}</Alert>}

      {allowed && halls && (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[0.8125rem] tracking-[0.06em] text-text-subtle uppercase">Залы</span>
            {halls.map((item) => (
              <Tab
                key={item.id}
                active={item.id === hallId}
                onClick={() => setHallId(item.id)}
                title={item.canPlan ? undefined : 'Смены здесь назначает управляющий этого зала'}
              >
                {item.name}
              </Tab>
            ))}
          </div>

          {hall && owner && (
            <Card className="mb-6">
              <CardHeader
                title="Управляющий зала"
                description="Назначает администраторов на смены этого зала. У зала — не больше одного, управляющий может вести несколько залов. Роль «управляющий» выдаётся в «Составе клуба»."
              />
              <CardBody>
                <select
                  aria-label={`Управляющий зала «${hall.name}»`}
                  value={hall.managerId ?? ''}
                  onChange={(event) => void setManager(hall.id, event.target.value || null)}
                  className={cn(inputClassName, 'w-auto min-w-64')}
                >
                  <option value="">Без управляющего — смены назначает руководитель</option>
                  {managers.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName}
                    </option>
                  ))}
                </select>
              </CardBody>
            </Card>
          )}

          {hall && !owner && hall.managerName && (
            <p className="mb-4 text-[0.875rem] text-text-muted">Управляющий зала: {hall.managerName}</p>
          )}

          {hall && !hall.canPlan && (
            <Alert tone="info">Смены в этом зале назначает его управляющий.</Alert>
          )}

          {hall?.canPlan && schedule === null && <p className="text-[0.9375rem] text-text-muted">Загружаю…</p>}

          {hall?.canPlan && schedule && schedule.candidates.length === 0 && (
            <Alert tone="info">
              В клубе нет администраторов — назначьте роль «администратор» в «Составе клуба».
            </Alert>
          )}

          {hall?.canPlan && schedule && schedule.candidates.length > 0 && (
            <Card>
              <CardHeader title="Смены на три недели" description="Нажмите на имя — человек встанет на смену или снимется с неё." />
              <CardBody>
                <ul className="divide-y divide-border">
                  {schedule.days.map((day) => (
                    <li key={day.date} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
                      <span className="w-52 shrink-0 text-[0.9375rem]">
                        {dayLabel(day.date)}
                        {day.date === schedule.today && (
                          <span className="ml-2 text-[0.75rem] tracking-[0.06em] text-text-accent uppercase">сегодня</span>
                        )}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-wrap gap-1.5" role="group" aria-label={`Смена ${dayLabel(day.date)}`}>
                        {schedule.candidates.map((person) => (
                          <Tab
                            key={person.id}
                            active={day.adminIds.includes(person.id)}
                            onClick={() => void toggle(day.date, person.id)}
                          >
                            {shortName(person.fullName)}
                          </Tab>
                        ))}
                      </span>
                      <span className="w-28 text-right text-[0.8125rem] text-text-subtle">
                        {pendingDate === day.date
                          ? 'Сохраняю…'
                          : day.adminIds.length === 0
                            ? 'никого'
                            : `${day.adminIds.length} ${plural(day.adminIds.length, 'человек', 'человека', 'человек')}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </AdminShell>
  );
}

/** «2026-09-27» → «вс, 27 сентября» — дата зала, без часового пояса. */
function dayLabel(date: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'long' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}
