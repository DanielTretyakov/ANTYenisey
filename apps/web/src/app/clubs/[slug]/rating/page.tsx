'use client';

import { useEffect, useState } from 'react';
import type { RatingPeriod } from '@yenisey/types';
import { ClubSubpage } from '@/components/club/ClubSubpage';
import { RatingFull } from '@/components/club/ClubRatingColumn';

const PERIODS: RatingPeriod[] = ['month', 'year', 'all'];

/**
 * Рейтинг посещений клуба целиком — страницей (решение владельца от
 * 30.09.2026: развёрнутый рейтинг — не всплывающим окном). Период приходит из
 * колонки адресом `?period=`; читается в эффекте, без `useSearchParams`.
 */
export default function ClubRatingPage() {
  const [period, setPeriod] = useState<RatingPeriod | null>(null);

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('period');
    setPeriod(PERIODS.includes(wanted as RatingPeriod) ? (wanted as RatingPeriod) : 'month');
  }, []);

  return (
    <ClubSubpage
      title="Рейтинг посещений"
      description="Сколько дней человек был в клубе: занятия, турниры, аренда и спарринги с отметкой «пришёл». Несколько визитов за день считаются как один. Месяц и год — календарные."
    >
      {period && <RatingFull initialPeriod={period} />}
    </ClubSubpage>
  );
}
