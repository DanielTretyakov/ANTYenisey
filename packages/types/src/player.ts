/**
 * Профиль игрока: аватар, инвентарь, достижения, спортивный разряд.
 *
 * Расширение сверх ТЗ по решению владельца продукта от 12.09.2026. Профиль —
 * свойство человека, а не клуба: аккаунт один на платформу, и разряд не
 * меняется от того, в каком зале человек сегодня играет.
 */

/** Разряды и звания по ЕВСК, от младшего к старшему. */
export type SportRankLevel =
  | 'YOUTH_3'
  | 'YOUTH_2'
  | 'YOUTH_1'
  | 'SPORT_3'
  | 'SPORT_2'
  | 'SPORT_1'
  | 'KMS'
  | 'MS'
  | 'MSMK';

export const SPORT_RANK_LEVELS: readonly SportRankLevel[] = [
  'YOUTH_3',
  'YOUTH_2',
  'YOUTH_1',
  'SPORT_3',
  'SPORT_2',
  'SPORT_1',
  'KMS',
  'MS',
  'MSMK',
];

export type SportRankStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export type AchievementLevel = 'INTERNATIONAL' | 'NATIONAL' | 'REGIONAL' | 'CITY' | 'CLUB';

export const ACHIEVEMENT_LEVELS: readonly AchievementLevel[] = [
  'INTERNATIONAL',
  'NATIONAL',
  'REGIONAL',
  'CITY',
  'CLUB',
];

/**
 * С какого возраста профиль виден посторонним.
 *
 * До шестнадцати страница игрока закрыта от всех, кроме него самого и
 * администраторов его клубов: фотография ребёнка и список его соревнований —
 * не то, что платформа раздаёт всем подряд.
 */
export const PUBLIC_PROFILE_AGE = 16;

/** Инвентарь — свободный текст: каталога оснований и накладок нет. */
export interface PlayerEquipment {
  blade: string | null;
  forehandRubber: string | null;
  backhandRubber: string | null;
}

export interface PlayerAchievement {
  id: string;
  title: string;
  /** «2025-04-12». */
  date: string;
  level: AchievementLevel;
  /** Пусто — «участие». */
  place: number | null;
  note: string | null;
}

export interface AchievementRequest {
  title: string;
  date: string;
  level: AchievementLevel;
  place?: number | null;
  note?: string | null;
}

/** Клуб, от имени которого принято решение по разряду. */
export interface RankReviewer {
  clubName: string;
  clubSlug: string;
  /** Когда. */
  at: string;
  /**
   * Кто именно, «Фамилия И.». Только в полном профиле: посторонним
   * достаточно клуба — решение принимает клуб, а не человек.
   */
  by?: string;
}

/** Файл, приложенный к разряду, — без байтов. */
export interface StoredFileMeta {
  id: string;
  contentType: string;
  size: number;
}

/**
 * Разряд целиком — для самого человека и администраторов его клубов.
 *
 * Здесь скан приказа и причина отказа: посторонним их не показывают.
 */
export interface PlayerRank {
  rank: SportRankLevel;
  status: SportRankStatus;
  orderNumber: string | null;
  orderDate: string | null;
  document: StoredFileMeta | null;
  reviewedBy: RankReviewer | null;
  rejectionReason: string | null;
  /**
   * Версия разряда. Администратор присылает её вместе с решением: решение
   * принимается о том, что он видел, и если игрок успел поправить разряд,
   * сервер ответит 409, а не подтвердит непросмотренное.
   */
  version: string;
}

/** Профиль игрока целиком: «Кабинет» и карточка человека у администратора. */
export interface PlayerProfile {
  userId: string;
  avatarFileId: string | null;
  equipment: PlayerEquipment;
  achievements: PlayerAchievement[];
  rank: PlayerRank | null;
  /** Виден ли профиль посторонним. До шестнадцати — нет. */
  isPublic: boolean;
}

export interface UpdateEquipmentRequest {
  blade?: string | null;
  forehandRubber?: string | null;
  backhandRubber?: string | null;
}

/** Решение администратора по разряду. */
export interface RankReviewRequest {
  decision: 'VERIFIED' | 'REJECTED';
  /** Обязательна при отказе и при пересмотре чужого решения. */
  reason?: string;
  /** `PlayerRank.version` — то, что администратор видел. */
  version: string;
}

/**
 * Разряд на публичной странице.
 *
 * Отклонённый не показывается вовсе: «КМС» без пометки вводил бы в
 * заблуждение, а «КМС — отклонён» выставлял бы человека на всеобщее
 * обозрение. Он видит отказ у себя в «Кабинете».
 */
export interface PublicRank {
  rank: SportRankLevel;
  status: 'PENDING' | 'VERIFIED';
  verifiedBy: RankReviewer | null;
}

/**
 * Публичная страница игрока. Ни телефона, ни почты, ни даты рождения — и имя
 * в том же виде, что в списках записавшихся: «Фамилия И.».
 */
export interface PublicPlayer {
  id: string;
  name: string;
  avatarFileId: string | null;
  equipment: PlayerEquipment;
  achievements: PlayerAchievement[];
  rank: PublicRank | null;
  /**
   * Профиль закрыт от посторонних (игроку нет шестнадцати), а смотрит тот,
   * кому можно, — сам игрок или администратор его клуба.
   */
  hiddenFromPublic: boolean;
}
