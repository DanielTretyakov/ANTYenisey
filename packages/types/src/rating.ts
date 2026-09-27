import type { Gender } from './auth';
import type { EventParticipant } from './platform';

/**
 * Рейтинг посещений клуба (решение владельца от 26.09.2026): публичный, на
 * странице клуба. Визит — отметка «пришёл» на занятии, турнире, аренде,
 * спарринге ученика или визит с порога, не больше одного в день.
 */
export type RatingPeriod = 'month' | 'year' | 'all';

/**
 * Строка рейтинга. Человек — теми же правилами, что кружок в окне
 * мероприятия: имя сокращено, у игрока младше 14 ни ссылки, ни фото.
 */
export interface ClubRatingRow extends EventParticipant {
  place: number;
  visits: number;
}

export interface ClubRating {
  period: RatingPeriod;
  /** Только мужчины или только женщины — без игроков младше 14; пусто — все. */
  gender: Gender | null;
  /** С какой даты считается период — «2026-09-01»; у «всего времени» пусто. */
  since: string | null;
  rows: ClubRatingRow[];
  /**
   * Место смотрящего, если он вошёл и есть в рейтинге, — даже за пределами
   * первой полусотни. Пусто — не входил, не ходил или скрылся.
   */
  me: ClubRatingRow | null;
  /** Скрыт ли смотрящий из рейтингов — для выключателя рядом. */
  meHidden: boolean | null;
}
