/**
 * Когда предупреждать человека, что абонемент кончается.
 *
 * Пороги заданы владельцем 20.09.2026: по визитам — 5 и 1, по сроку — 7, 3 и
 * 1 день. Срочность считается по тому, что кончится раньше: у абонемента «5
 * визитов на 30 дней» последний визит может остаться в первую неделю, а может
 * и не остаться.
 *
 * Модуль самодостаточен намеренно: его гоняет `node --test`, а тот требует от
 * относительных импортов расширения `.ts`, которых сборка не принимает.
 * Поэтому здесь только решение, без единой подписи — слова собирает вызывающий.
 */

/** Насколько срочно. `last` — последний визит или последний день. */
export type AlertLevel = 'last' | 'near' | 'soon';

export type SubscriptionAlert =
  | { kind: 'visits'; level: AlertLevel; visits: number }
  | { kind: 'days'; level: AlertLevel; days: number };

/** Абонемент в том объёме, в каком о нём судит это правило. */
export interface AlertSubject {
  remainingVisits: number | null;
  expiresAt: string | null;
  active: boolean;
}

const DAY = 86_400_000;

export function subscriptionAlert(sub: AlertSubject, now: Date): SubscriptionAlert | null {
  // Закончившийся не предупреждают: ему уже не «скоро», ему «всё». Об этом
  // говорит сама строка абонемента, помеченная как недействующая.
  if (!sub.active) {
    return null;
  }

  const visits = visitsAlert(sub.remainingVisits);
  const days = daysAlert(sub.expiresAt, now);

  if (!visits) return days;
  if (!days) return visits;

  // Обе половины кончаются — говорим о той, что ближе. Порядок важен: человеку
  // нужна одна понятная причина, а не две сразу.
  return rank(days.level) < rank(visits.level) ? days : visits;
}

function visitsAlert(remaining: number | null): SubscriptionAlert | null {
  // Безлимит визитами не кончается — только сроком.
  if (remaining === null || remaining > 5) {
    return null;
  }

  return { kind: 'visits', level: remaining <= 1 ? 'last' : 'soon', visits: remaining };
}

function daysAlert(expiresAt: string | null, now: Date): SubscriptionAlert | null {
  if (expiresAt === null) {
    return null;
  }

  const left = Date.parse(expiresAt) - now.getTime();

  // `expiresAt` — первая минута, когда абонемент уже не действует, поэтому
  // «сегодня последний день» — это любой остаток меньше суток, вплоть до
  // нескольких минут. Округление вверх и даёт «1 день».
  const days = Math.ceil(left / DAY);

  if (days > 7) {
    return null;
  }

  return { kind: 'days', level: days <= 1 ? 'last' : days <= 3 ? 'near' : 'soon', days: Math.max(days, 1) };
}

function rank(level: AlertLevel): number {
  return level === 'last' ? 0 : level === 'near' ? 1 : 2;
}
