'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import type { CoachInClub, CoachStatsPeriod, Gender } from '@yenisey/types';
import { PlayerAvatar } from '@/components/player/PlayerView';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { useClubApi } from '@/lib/useClubApi';
import { CoachCardBody, CoachPricesView } from './CoachView';
import { CoachStatsPanel } from './CoachStatsPanel';

/**
 * Карточка тренера в карточке человека — для администратора, только чтение.
 *
 * Править её клуб больше не может (решение владельца от 20.09.2026, отступление
 * от ТЗ): карточка одна на все клубы, где человек тренирует, и правка из
 * «Енисея» меняла бы то, что о себе рассказывает тренер соседнему клубу.
 * Клубное здесь — цены и статистика этого клуба.
 */
export function CoachCard({
  coach,
  personId,
  personName,
  gender = null,
}: {
  coach: CoachInClub;
  personId: string;
  personName: string;
  /** Пол — для заглушки, пока тренер не загрузил фото. */
  gender?: Gender | null;
}) {
  const club = useClubApi();

  const loadStats = useCallback(
    (period: CoachStatsPeriod) => club.coachStatsOf(personId, period),
    [club, personId],
  );

  return (
    <Card>
      <CardHeader
        title="Карточка тренера"
        description="Публичная страница: её видят все, не входя. Заполняет её сам тренер — она одна на все его клубы."
      />
      <CardBody className="grid gap-7">
        <div className="flex flex-wrap items-start gap-5">
          <PlayerAvatar fileId={coach.card.photoFileId} name={personName} gender={gender} size="lg" />
          <div className="min-w-[12rem] flex-1">
            <CoachCardBody card={coach.card} />
          </div>
        </div>

        <section>
          <h3 className="mb-2 text-[0.9375rem] font-medium">Стоимость занятий в клубе</h3>
          <CoachPricesView prices={coach.prices} />
          <p className="mt-2 text-[0.8125rem] text-text-subtle">
            Цены тренер указывает сам в разделе «Моя карточка» — в каждом клубе свои.
          </p>
        </section>

        <section>
          <h3 className="mb-3.5 text-[0.9375rem] font-medium">Статистика занятий</h3>
          <CoachStatsPanel load={loadStats} />
        </section>

        <p className="text-[0.875rem]">
          <Link href={`/coaches/${personId}`} className="text-text-accent underline-offset-2 hover:underline">
            Страница тренера →
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
