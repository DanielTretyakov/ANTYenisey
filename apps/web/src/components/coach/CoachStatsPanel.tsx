'use client';

import { useEffect, useState } from 'react';
import type { CoachStats, CoachStatsPeriod } from '@yenisey/types';
import { COACH_STATS_PERIODS } from '@yenisey/types';
import { Alert } from '@/components/ui/Alert';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/lib/api';

const PERIOD_LABELS: Record<CoachStatsPeriod, string> = {
  30: 'За 30 дней',
  90: 'За 90 дней',
  365: 'За год',
  0: 'За всё время',
};

/**
 * Статистика тренера по проведённым занятиям.
 *
 * Один блок на двоих — тренер смотрит на себя, клуб на тренера (ТЗ: «статистика
 * посещаемости доступна и по каждому тренеру»). Различается только, откуда
 * брать цифры: страница передаёт загрузчик.
 */
export function CoachStatsPanel({ load }: { load: (period: CoachStatsPeriod) => Promise<CoachStats> }) {
  const [period, setPeriod] = useState<CoachStatsPeriod>(90);
  const [stats, setStats] = useState<CoachStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setError(null);
    load(period)
      .then((loaded) => {
        if (!cancelled) setStats(loaded);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.message : 'Не удалось связаться с сервером');
      });

    return () => {
      cancelled = true;
    };
  }, [load, period]);

  return (
    <div>
      <div className="max-w-60">
        <Select
          label="Срок"
          value={String(period)}
          onChange={(event) => setPeriod(Number(event.target.value) as CoachStatsPeriod)}
          options={COACH_STATS_PERIODS.map((value) => ({ value: String(value), label: PERIOD_LABELS[value] }))}
        />
      </div>

      {error && <Alert>{error}</Alert>}

      {stats && stats.sessions === 0 && (
        <p className="text-[0.875rem] text-text-muted">За этот срок проведённых занятий нет.</p>
      )}

      {stats && stats.sessions > 0 && (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            <Figure label="Занятий" value={String(stats.sessions)} />
            <Figure
              label="Посещаемость"
              value={stats.attendanceRate === null ? '—' : `${stats.attendanceRate} %`}
              note="пришли среди отмеченных"
            />
            <Figure
              label="Приходит в среднем"
              value={stats.averageAttendance === null ? '—' : formatOne(stats.averageAttendance)}
              note="человек на занятие"
            />
            <Figure
              label="Заполненность"
              value={stats.averageFill === null ? '—' : `${stats.averageFill} %`}
              note="записей к местам"
            />
          </dl>

          <p className="mt-5 text-[0.875rem] text-text-muted">
            Пришли {stats.attended} · не пришли {stats.noShows} · отменили {stats.cancelled}
          </p>

          {stats.unmarked > 0 && (
            <p className="mt-1.5 text-[0.8125rem] text-text-subtle">
              Без отметки: {stats.unmarked}. Посещаемость посчитана без них — отметку ставит администратор на смене.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.75rem] tracking-[0.06em] text-text-subtle uppercase">{label}</dt>
      <dd className="mt-1 font-display text-[1.5rem] leading-tight tabular-nums">{value}</dd>
      {note && <dd className="mt-0.5 text-[0.8125rem] text-text-muted">{note}</dd>}
    </div>
  );
}

/** «2,5» — с запятой, как пишут по-русски; целое — без хвоста. */
function formatOne(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);
}
