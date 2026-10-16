'use client';

import { useEffect, useState } from 'react';
import type { CoachGroup } from '@yenisey/types';
import { Tab } from '@/components/ui/Tab';
import { WhenSpan } from '@/components/club/When';
import { CoachStatsPanel } from '@/components/coach/CoachStatsPanel';
import { HelpHint } from '@/components/help/HelpHint';
import { AppShell } from '@/components/layout/AppShell';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ApiError, clubApi } from '@/lib/api';
import { useClubApi, useClubSlug } from '@/lib/useClubApi';
import { useSession } from '@/lib/useSession';

/** Группа с клубом: в ленте «все мои клубы» без него не понять, куда ехать. */
type ClubGroup = CoachGroup & { club: { slug: string; name: string } | null };

/**
 * «Мои группы» — занятия тренера вместе с составом.
 *
 * Только предстоящие и идущие: прошедшие — вопрос отметки и денег, а это
 * работа администратора на экране смены. Отметок и сумм здесь нет намеренно.
 *
 * Полное имя и телефон, а не «Фамилия И.»: тренеру нужно позвонить ученику,
 * и те же данные он видит в составе клуба.
 */
export default function CoachGroupsPage() {
  const club = useClubApi();
  const slug = useClubSlug();
  const session = useSession();
  const [groups, setGroups] = useState<ClubGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Все клубы тренера одной лентой (решение владельца от 12.10.2026): тренер
  // в двух клубах иначе собирал бы неделю из двух страниц.
  const [scope, setScope] = useState<'club' | 'all'>('club');

  const coachClubs =
    session.status === 'ready'
      ? session.user.memberships.filter((membership) => membership.roles.includes('COACH'))
      : [];
  const several = coachClubs.length > 1;
  const clubsKey = coachClubs.map((membership) => membership.slug).join(',');

  useEffect(() => {
    setGroups(null);

    const load: Promise<ClubGroup[]> =
      scope === 'all' && several
        ? Promise.all(
            coachClubs.map((membership) =>
              clubApi(membership.slug)
                .coachGroups()
                .then((list) => list.map((group) => ({ ...group, club: { slug: membership.slug, name: membership.name } }))),
            ),
          ).then((lists) => lists.flat().sort((a, b) => a.startsAt.localeCompare(b.startsAt)))
        : club.coachGroups().then((list) => list.map((group) => ({ ...group, club: null })));

    load
      .then(setGroups)
      .catch((cause: unknown) =>
        setError(
          cause instanceof ApiError && cause.status === 403
            ? 'Эта страница — для тренеров клуба.'
            : cause instanceof ApiError
              ? cause.message
              : 'Нет связи. Проверьте интернет и попробуйте ещё раз',
        ),
      );
    // Клубы тренера — по строке-ключу: массив из профиля пересобирается каждый раз.
  }, [club, scope, clubsKey]);

  return (
    <AppShell footer="line" clubSlug={slug}>
      <h1 className="text-[2rem] leading-tight">Мои группы</h1>
      <HelpHint slug="moi-gruppy" className="mt-1 mb-6" />

      {error && <Alert tone="warning">{error}</Alert>}

      {!error && (
        <Card className="mb-6">
          <CardHeader
            title="Статистика"
            description="По проведённым занятиям. Эти же цифры клуб видит в вашей карточке."
          />
          <CardBody>
            <CoachStatsPanel load={club.coachStats} />
          </CardBody>
        </Card>
      )}

      {several && (
        <div className="mb-4 flex gap-1.5" role="tablist" aria-label="Чьи занятия">
          <Tab inTablist active={scope === 'club'} onClick={() => setScope('club')}>
            Этот клуб
          </Tab>
          <Tab inTablist active={scope === 'all'} onClick={() => setScope('all')}>
            Все мои клубы
          </Tab>
        </div>
      )}

      {groups?.length === 0 && (
        <Alert tone="info">Впереди занятий нет. Занятия ставит администратор в расписании зала.</Alert>
      )}

      {groups && groups.length > 0 && (
        <div className="grid gap-5">
          {groups.map((group) => (
            <Card key={`${group.club?.slug ?? slug}:${group.id}`}>
              <CardHeader
                title={group.title}
                description={`${group.club ? `${group.club.name} · ` : ''}Записались: ${group.participants.length} из ${group.capacity}`}
              />
              <CardBody className="flex flex-wrap items-start gap-6">
                <WhenSpan startsAt={group.startsAt} endsAt={group.endsAt} />

                <div className="min-w-0 flex-1">
                  {group.participants.length === 0 ? (
                    <p className="text-[0.875rem] text-text-muted">Пока никто не записался.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {group.participants.map((participant) => (
                        <li
                          key={participant.userId}
                          className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-2 first:pt-0 last:pb-0"
                        >
                          <span className="min-w-0 text-[0.9375rem] break-words">{participant.fullName}</span>
                          <a
                            href={`tel:${participant.phone}`}
                            className="text-[0.875rem] tabular-nums text-text-accent underline-offset-2 hover:underline"
                          >
                            {participant.phone}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
