/**
 * Статистика тренера: чистая арифметика, отделённая от базы.
 *
 * Относительных импортов нет намеренно: модуль гоняется через `node --test`
 * (см. CLAUDE.md). Всё внешнее — занятия с их составом — приходит аргументом.
 *
 * Правило одно и главное: посещаемость считается по ОТМЕЧЕННЫМ записям, а
 * неотмеченные показываются отдельным числом. Иначе смена, где администратор
 * не успел отметить присутствие, выглядела бы у тренера как день, когда никто
 * не пришёл, — и цифра, которой не веришь, хуже отсутствующей.
 */
import type { CoachStats, CoachStatsPeriod } from '@yenisey/types';

/** Занятие в том объёме, в каком оно попадает в статистику. */
export interface StatsSession {
  /** Момент окончания в ISO. */
  endsAt: string;
  capacity: number;
  /** Статусы записей на это занятие. */
  entries: readonly ('BOOKED' | 'ATTENDED' | 'NO_SHOW' | 'CANCELLED')[];
}

/** Порог периода: занятия, закончившиеся раньше, в расчёт не идут. */
export function periodStart(period: CoachStatsPeriod, now: Date): Date | null {
  return period === 0 ? null : new Date(now.getTime() - period * 86_400_000);
}

export function coachStats(
  sessions: readonly StatsSession[],
  period: CoachStatsPeriod,
  now: Date,
): CoachStats {
  const from = periodStart(period, now);

  // Идущее сейчас занятие не считается: отметок по нему ещё нет.
  const counted = sessions.filter((session) => {
    const ended = Date.parse(session.endsAt);

    return ended <= now.getTime() && (from === null || ended >= from.getTime());
  });

  const stats: CoachStats = {
    period,
    sessions: counted.length,
    entries: 0,
    attended: 0,
    noShows: 0,
    cancelled: 0,
    unmarked: 0,
    attendanceRate: null,
    averageAttendance: null,
    averageFill: null,
  };

  let places = 0;
  // Записи без отменённых: заполненность группы — про тех, кто на занятие
  // рассчитывал, а отменившие место освободили.
  let signedUp = 0;

  for (const session of counted) {
    places += session.capacity;

    for (const entry of session.entries) {
      stats.entries += 1;

      if (entry !== 'CANCELLED') signedUp += 1;

      switch (entry) {
        case 'ATTENDED':
          stats.attended += 1;
          break;
        case 'NO_SHOW':
          stats.noShows += 1;
          break;
        case 'CANCELLED':
          stats.cancelled += 1;
          break;
        case 'BOOKED':
          stats.unmarked += 1;
          break;
      }
    }
  }

  const marked = stats.attended + stats.noShows;

  if (marked > 0) {
    stats.attendanceRate = Math.round((stats.attended / marked) * 100);
  }

  if (counted.length > 0) {
    // Одна цифра после запятой: «7,5 человека в среднем» — осмысленно,
    // «7,4823» — нет.
    stats.averageAttendance = Math.round((stats.attended / counted.length) * 10) / 10;
  }

  if (places > 0) {
    stats.averageFill = Math.round((signedUp / places) * 100);
  }

  return stats;
}
