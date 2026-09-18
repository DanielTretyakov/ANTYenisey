'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import type { CoachProfile } from '@yenisey/types';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { useClubApi } from '@/lib/useClubApi';
import { CoachEditor, type CoachActions } from './CoachEditor';

/**
 * Карточка тренера в карточке человека — для администратора.
 *
 * В отличие от профиля игрока, который клуб только читает, карточку тренера
 * администратор правит: так сказано в ТЗ («заполняет и редактирует сам тренер
 * либо admin/owner»). Тренер, у которого нет времени между группами,
 * рассказывает о себе администратору, а тот заполняет.
 */
export function CoachCard({
  coach,
  personId,
  personName,
  onChange,
}: {
  coach: CoachProfile;
  personId: string;
  personName: string;
  onChange: (coach: CoachProfile) => void;
}) {
  const club = useClubApi();

  const actions = useMemo<CoachActions>(
    () => ({
      update: (patch) => club.updateCoachOf(personId, patch),
      setPhoto: (file) => club.setCoachPhotoOf(personId, file),
      removePhoto: () => club.removeCoachPhotoOf(personId),
    }),
    [club, personId],
  );

  return (
    <Card>
      <CardHeader
        title="Карточка тренера"
        description="Публичная страница: её видят все, не входя. Правит сам тренер или клуб."
      />
      <CardBody className="grid gap-7">
        <CoachEditor profile={coach} name={personName} actions={actions} onChange={onChange} />

        <p className="text-[0.875rem]">
          <Link href={`/coaches/${personId}`} className="text-text-accent underline-offset-2 hover:underline">
            Страница тренера →
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
