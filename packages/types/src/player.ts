import type { Gender } from './auth';
import type { RatingSystem } from './eligibility';

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

/**
 * Коротко — так, как разряд называют в зале.
 *
 * В общем пакете, потому что называют его обе стороны: веб в профиле, сервер
 * в сообщении бота о решении клуба. Две копии разошлись бы на первой правке.
 */
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
 * До четырнадцати страница игрока закрыта от всех, кроме него самого и
 * администраторов его клубов: фотография ребёнка и список его соревнований —
 * не то, что платформа раздаёт всем подряд.
 */
export const PUBLIC_PROFILE_AGE = 14;

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
  /** Пол — для заглушки, когда фотографии нет. */
  gender: Gender | null;
  equipment: PlayerEquipment;
  achievements: PlayerAchievement[];
  rank: PlayerRank | null;
  /** Виден ли профиль посторонним. До четырнадцати — нет. */
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
  /** Пол — для заглушки, когда фотографии нет. */
  gender: Gender | null;
  equipment: PlayerEquipment;
  achievements: PlayerAchievement[];
  rank: PublicRank | null;
  /**
   * Профиль закрыт от посторонних (игроку нет четырнадцати), а смотрит тот,
   * кому можно, — сам игрок или администратор его клуба.
   */
  hiddenFromPublic: boolean;
  /**
   * «Больше всего посещений» (решение владельца от 30.09.2026): три клуба,
   * где игрок бывал чаще всего, за месяц, год и всё время. `null` — скрыто
   * от смотрящего: игрок убрал себя из рейтингов, а смотрит не он и не его
   * родитель.
   */
  visits: PlayerVisitTops | null;
  /**
   * Рейтинги во внешних системах — плашками (решения владельца от 20.10.2026).
   * Находит их сервер сам, раз в сутки; не нашёл — плашки нет. Порядок —
   * ФНТР, RTTF, RTTW.
   */
  externalRatings: ExternalRatingBadge[];
}

/** Плашка рейтинга внешней системы в профиле игрока. */
export interface ExternalRatingBadge {
  system: RatingSystem;
  rating: number;
  /** Место в общем рейтинге; RTTW его в списке не даёт. */
  place: number | null;
  /** На какую дату рейтинг в источнике, «YYYY-MM-DD». */
  asOf: string | null;
  /** Страница игрока в источнике. */
  url: string;
}

/**
 * Вариант «выберите себя» (решение владельца от 20.10.2026): сверка нашла под
 * ФИО и год человека нескольких игроков источника. Видит только он сам (и
 * родитель за ребёнка).
 */
export interface ExternalRatingChoice {
  externalId: string;
  /** Как игрок записан в источнике — «Иванов Пётр Сергеевич». */
  name: string;
  city: string | null;
  birthYear: number | null;
  rating: number;
  place: number | null;
  /** Страница игрока в источнике — свериться, прежде чем выбрать. */
  url: string;
}

/** Своё о внешних рейтингах: что закреплено самим и из чего выбирать. */
export interface MyExternalRatings {
  /** Системы, где человек сам выбрал себя: их можно открепить. */
  claimed: RatingSystem[];
  choices: Partial<Record<RatingSystem, ExternalRatingChoice[]>>;
}

/** По чему упорядочить «Найти игрока»: по фамилии или по рейтингу системы. */
export type PlayerSearchSort = 'name' | RatingSystem;

/**
 * Строка «Найти игрока» (решения владельца от 20.10.2026): все с 14 лет,
 * кроме скрывшихся флажком «не показывать меня в рейтингах».
 */
export interface PlayerSearchRow {
  id: string;
  /** «Фамилия Имя» — без отчества (решение от 20.10.2026). */
  name: string;
  /** Пусто — дата рождения не указана (старые учётки). */
  birthYear: number | null;
  avatarFileId: string | null;
  gender: Gender | null;
  /** Тренирует сейчас в открытом клубе — ссылка на карточку тренера. */
  isCoach: boolean;
  /** Клуб, где чаще всего бывал за последние 365 дней. */
  topClub: { slug: string; name: string; accentColor: string | null } | null;
  /** Рейтинги систем; пусто — не найден. */
  ratings: Record<RatingSystem, number | null>;
}

export interface PlayerSearchPage {
  total: number;
  rows: PlayerSearchRow[];
}

/** Клуб в «Больше всего посещений». */
export interface ClubVisits {
  slug: string;
  name: string;
  accentColor: string | null;
  logoFileId: string | null;
  place: number;
  visits: number;
}

export interface PlayerVisitTops {
  month: ClubVisits[];
  year: ClubVisits[];
  all: ClubVisits[];
  /** Игрок скрыл себя из рейтингов: блок видят только он и его родитель. */
  hiddenFromOthers: boolean;
}

/**
 * Разряд коротко — на карточке тренера (решение владельца от 26.10.2026), как
 * на странице игрока: подтверждённый — просто «КМС», заявленный — с пометкой,
 * нет — прочерк. Отклонённый сюда не доходит: его нет в `PublicRank`.
 */
export function publicRankLabel(rank: PublicRank | null): string {
  if (!rank) return '—';

  return rank.status === 'VERIFIED' ? RANK_LABELS[rank.rank] : `${RANK_LABELS[rank.rank]}, не подтверждён`;
}
