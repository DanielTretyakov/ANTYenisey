/**
 * Правила профиля игрока: кому он виден и как меняется разряд.
 *
 * Чистый модуль без относительных импортов: его гоняет `node --test`, а тот
 * требует расширение `.ts` в пути, которого не принимает сборка. Всё внешнее —
 * «сегодня», роль смотрящего, текущее состояние разряда — приходит
 * аргументами. Общий пакет импортируется по имени, это не относительный путь.
 */
import { fullYears, PUBLIC_PROFILE_AGE } from '@yenisey/types';

export function isProfilePublic(birthDate: Date, today: Date): boolean {
  return fullYears(birthDate, today) >= PUBLIC_PROFILE_AGE;
}

/** Кто смотрит и кем он приходится игроку. */
export interface ProfileViewer {
  /** Пусто — посетитель не вошёл. */
  viewerId: string | null;
  /**
   * Администратор или руководство клуба, где игрок состоит. Им виден профиль
   * целиком и скан приказа: разряд проверяют именно они.
   */
  managesOwner: boolean;
  /** Родитель, который ведёт игрока, пока тому нет 14: он и ведёт его профиль. */
  guardsOwner: boolean;
}

export interface ProfileOwner {
  ownerId: string;
  birthDate: Date;
}

/**
 * Видна ли страница игрока этому человеку.
 *
 * Сам игрок, его родитель и администраторы его клубов видят её всегда,
 * остальные — с четырнадцати лет.
 */
export function canSeeProfile(owner: ProfileOwner, viewer: ProfileViewer, today: Date): boolean {
  return (
    viewer.viewerId === owner.ownerId ||
    viewer.guardsOwner ||
    viewer.managesOwner ||
    isProfilePublic(owner.birthDate, today)
  );
}

/**
 * Можно ли отдать файл.
 *
 * Аватар — тем же, кому виден профиль. Скан приказа — только самому человеку,
 * его родителю и администраторам его клубов, в любом возрасте: там паспортные
 * данные. Фотография тренера — всем: карточка тренера публична, и возраста у
 * неё нет, тренером человек становится взрослым.
 */
export function canReadFile(
  kind: 'AVATAR' | 'RANK_DOCUMENT' | 'COACH_PHOTO' | 'CLUB_BANNER',
  owner: ProfileOwner,
  viewer: ProfileViewer,
  today: Date,
): boolean {
  // Фото тренера и баннер клуба — часть открытых страниц, возраста у них нет.
  if (kind === 'COACH_PHOTO' || kind === 'CLUB_BANNER') {
    return true;
  }

  if (kind === 'AVATAR') {
    return canSeeProfile(owner, viewer, today);
  }

  return viewer.viewerId === owner.ownerId || viewer.guardsOwner || viewer.managesOwner;
}

/**
 * Записавшийся в открытом окне мероприятия: кружок со ссылкой на профиль или
 * только инициалы.
 *
 * Ссылка и фотография — только у открытого профиля, и решается это без
 * смотрящего: окно одно на всех, и даже родитель видит в нём своего ребёнка
 * инициалами, как посторонний (решение владельца от 24.09.2026). Иначе
 * список записавшихся стал бы обходом закрытого профиля: по адресам кружков
 * собирался бы список несовершеннолетних с фотографиями.
 */
export function participantView<G extends string>(
  person: { userId: string; name: string; birthDate: Date; avatarFileId: string | null; gender: G | null },
  today: Date,
): { userId: string | null; name: string; avatarFileId: string | null; gender: G | null } {
  // Пол ребёнка тоже не раскрывается: кружок младше 14 — нейтральный.
  return isProfilePublic(person.birthDate, today)
    ? { userId: person.userId, name: person.name, avatarFileId: person.avatarFileId, gender: person.gender }
    : { userId: null, name: person.name, avatarFileId: null, gender: null };
}

/**
 * Строка из формы → то, что кладётся в базу: без пробелов по краям, пусто —
 * это null. Два написания «ничего не указано» база не примет
 * (constraints.sql, раздел 18).
 */
export function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';

  return trimmed === '' ? null : trimmed;
}

// ---------------------------------------------------------------------------
// Разряд
// ---------------------------------------------------------------------------

export type RankLevel =
  | 'YOUTH_3'
  | 'YOUTH_2'
  | 'YOUTH_1'
  | 'SPORT_3'
  | 'SPORT_2'
  | 'SPORT_1'
  | 'KMS'
  | 'MS'
  | 'MSMK';

export type RankStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

/** Разряд, как он лежит в базе сейчас. */
export interface RankState {
  rank: RankLevel;
  orderNumber: string | null;
  /** «2024-11-01». */
  orderDate: string | null;
  hasDocument: boolean;
  status: RankStatus;
  rejectionReason: string | null;
}

/** Что игрок прислал. Номер и дата — уже очищенные `cleanText`. */
export interface RankEdit {
  rank: RankLevel;
  orderNumber: string | null;
  orderDate: string | null;
  /** Что сделать со сканом: оставить, заменить новым или убрать. */
  document: 'keep' | 'replace' | 'remove';
}

export type Decision<T> = ({ ok: true } & T) | { ok: false; status: 400 | 403; message: string };

/**
 * Правка разряда игроком.
 *
 * Любая настоящая правка — и разряда, и приказа, и скана — возвращает разряд
 * на проверку: подпись «подтвердил клуб X» не должна висеть над тем, чего
 * клуб X не видел. Повтор того же самого ничего не меняет и подтверждение не
 * сбрасывает — иначе второе нажатие «Сохранить» стоило бы человеку проверки.
 */
export function decideRankEdit(current: RankState | null, edit: RankEdit): Decision<{ changed: boolean }> {
  if ((edit.orderNumber === null) !== (edit.orderDate === null)) {
    return { ok: false, status: 400, message: 'Номер и дата приказа указываются вместе' };
  }

  const documentAfter =
    edit.document === 'replace' || (edit.document === 'keep' && (current?.hasDocument ?? false));

  if (!documentAfter && edit.orderNumber === null) {
    return {
      ok: false,
      status: 400,
      message: 'Укажите номер и дату приказа или приложите его скан — иначе клубу нечем подтвердить разряд',
    };
  }

  if (!current) {
    return { ok: true, changed: true };
  }

  const changed =
    current.rank !== edit.rank ||
    current.orderNumber !== edit.orderNumber ||
    current.orderDate !== edit.orderDate ||
    edit.document === 'replace' ||
    (edit.document === 'remove' && current.hasDocument);

  return { ok: true, changed };
}

export interface RankReview {
  decision: 'VERIFIED' | 'REJECTED';
  reason: string | null;
  reviewerId: string;
  playerId: string;
}

/**
 * Решение администратора по разряду.
 *
 * - Свой разряд не подтверждает никто (решение владельца от 12.09.2026; то же
 *   держит CHECK `SportRank_not_self_review`).
 * - Отказ — только с причиной: человек должен понять, что исправить.
 * - Пересмотреть уже принятое решение может любой клуб игрока, но с причиной:
 *   отменяя чужое решение, клуб объясняет почему — так же, как исправление
 *   отметки присутствия.
 * - То же решение ещё раз ничего не меняет и в журнал не пишет. Подпись
 *   остаётся у того, кто решил первым.
 *
 * `reason` у подтверждения уходит только в журнал: причины отказа у
 * подтверждённого разряда нет.
 */
export function decideRankReview(
  current: RankState,
  review: RankReview,
): Decision<{ changed: boolean; rejectionReason: string | null; auditReason: string | null }> {
  if (review.reviewerId === review.playerId) {
    return { ok: false, status: 403, message: 'Свой разряд подтверждает администратор другого клуба или коллега' };
  }

  if (review.decision === 'REJECTED' && !review.reason) {
    return { ok: false, status: 400, message: 'Объясните причину отказа — человек увидит её у себя' };
  }

  const same =
    current.status === review.decision &&
    (review.decision === 'VERIFIED' || current.rejectionReason === review.reason);

  if (same) {
    return { ok: true, changed: false, rejectionReason: current.rejectionReason, auditReason: null };
  }

  if (current.status !== 'PENDING' && !review.reason) {
    return {
      ok: false,
      status: 400,
      message: 'Решение по разряду уже принято — чтобы его пересмотреть, укажите причину',
    };
  }

  return {
    ok: true,
    changed: true,
    rejectionReason: review.decision === 'REJECTED' ? review.reason : null,
    auditReason: review.reason,
  };
}
