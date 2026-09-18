'use client';

import { useEffect, useState } from 'react';
import type { CoachGroup } from '@yenisey/types';
import { WhenSpan } from '@/components/club/When';
import { AppShell } from '@/components/layout/AppShell';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ApiError } from '@/lib/api';
import { useClubApi } from '@/lib/useClubApi';

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
  const [groups, setGroups] = useState<CoachGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    club
      .coachGroups()
      .then(setGroups)
      .catch((cause: unknown) =>
        setError(
          cause instanceof ApiError && cause.status === 403
            ? 'Эта страница — для тренеров клуба.'
            : cause instanceof ApiError
              ? cause.message
              : 'Не удалось связаться с сервером',
        ),
      );
  }, [club]);

  return (
    <AppShell>
      <h1 className="mb-6 text-[2rem] leading-tight">Мои группы</h1>

      {error && <Alert tone="warning">{error}</Alert>}

      {groups?.length === 0 && (
        <Alert tone="info">Впереди занятий нет. Занятия ставит администратор в расписании зала.</Alert>
      )}

      {groups && groups.length > 0 && (
        <div className="grid gap-5">
          {groups.map((group) => (
            <Card key={group.id}>
              <CardHeader
                title={group.title}
                description={`Записались: ${group.participants.length} из ${group.capacity}`}
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
