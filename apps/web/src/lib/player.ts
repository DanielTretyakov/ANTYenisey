/**
 * Подписи профиля игрока: разряды, уровни соревнований, места, статус
 * проверки.
 *
 * Чистый модуль без относительных импортов — его гоняет `node --test`. Типы
 * берутся из общего пакета, это не относительный путь.
 */
import type { AchievementLevel, PlayerRank, PublicRank, SportRankLevel } from '@yenisey/types';

/** Коротко — так, как разряд называют в зале. */
export const RANK_LABELS: Record<SportRankLevel, string> = {
  YOUTH_3: '3-й юношеский',
  YOUTH_2: '2-й юношеский',
  YOUTH_1: '1-й юношеский',
  SPORT_3: '3-й спортивный',
  SPORT_2: '2-й спортивный',
  SPORT_1: '1-й спортивный',
  KMS: 'КМС',
  MS: 'МС',
  MSMK: 'МСМК',
};

/** Полностью — для подсказки и выпадающего списка. */
export const RANK_TITLES: Record<SportRankLevel, string> = {
  YOUTH_3: 'Третий юношеский разряд',
  YOUTH_2: 'Второй юношеский разряд',
  YOUTH_1: 'Первый юношеский разряд',
  SPORT_3: 'Третий спортивный разряд',
  SPORT_2: 'Второй спортивный разряд',
  SPORT_1: 'Первый спортивный разряд',
  KMS: 'Кандидат в мастера спорта',
  MS: 'Мастер спорта России',
  MSMK: 'Мастер спорта России международного класса',
};

export const LEVEL_LABELS: Record<AchievementLevel, string> = {
  INTERNATIONAL: 'международное',
  NATIONAL: 'всероссийское',
  REGIONAL: 'региональное',
  CITY: 'городское',
  CLUB: 'клубное',
};

/** «1 место» или «участие», когда места нет. */
export function placeLabel(place: number | null): string {
  return place === null ? 'участие' : `${place} место`;
}

/**
 * Название клуба в кавычках — если своих у него нет. «АНТ «Енисей»» в ещё
 * одних кавычках читается как опечатка.
 */
export function quoted(name: string): string {
  return /[«»"]/.test(name) ? name : `«${name}»`;
}

/** «2025-04-12» → «12 апреля 2025». Дата без времени — по UTC, без сдвига. */
export function longDate(value: string): string {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

/**
 * Одна строка о проверке разряда — то, что человек видит под разрядом.
 *
 * Отказ показывается с причиной: без неё непонятно, что исправить. Публичный
 * разряд причины не несёт — отклонённый посторонним не отдаётся вовсе.
 */
export function rankStatusLine(rank: PlayerRank | PublicRank): string {
  const reviewer = 'reviewedBy' in rank ? rank.reviewedBy : rank.verifiedBy;

  if (rank.status === 'PENDING') {
    return 'не подтверждён клубом';
  }

  const club = reviewer ? `клуб ${quoted(reviewer.clubName)}, ${longDate(reviewer.at)}` : 'клуб';

  if (rank.status === 'VERIFIED') {
    return `подтвердил ${club}`;
  }

  const reason = 'rejectionReason' in rank && rank.rejectionReason ? `: ${rank.rejectionReason}` : '';

  return `отклонил ${club}${reason}`;
}
