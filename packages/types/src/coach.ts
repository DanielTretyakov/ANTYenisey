import type { Gender } from './auth';
import type { PublicRank } from './player';

/**
 * Карточка тренера: фотография, достижения, инвентарь, соцсети.
 *
 * Карточка ОДНА на человека и общая для всех клубов, где он тренирует, — как
 * профиль игрока (решение владельца от 20.09.2026). Заполняет её только сам
 * тренер. Клубным осталось то, что у клубов действительно разное, — цены.
 */

/** Ссылка на соцсеть: подпись и адрес. Каталога сетей нет — их слишком много. */
export interface CoachSocialLink {
  label: string;
  url: string;
}

/** Больше десяти ссылок — это уже не «контакты», а список ссылок. */
export const MAX_COACH_SOCIAL_LINKS = 10;

/** Карточка так, как её правит сам тренер. Одна на все клубы. */
export interface CoachCard {
  userId: string;
  photoFileId: string | null;
  achievements: string | null;
  inventory: string | null;
  socialLinks: CoachSocialLink[];
  /** «Обо мне» — простой текст с пометками (`parseMarkup`), до 2000 знаков. */
  about: string | null;
  /** С какого года тренирует; стаж — `coachingYearsLabel`. */
  coachingSince: number | null;
}

/** Поле не прислано — не трогается; прислано пустым — стирается. */
export interface UpdateCoachCardRequest {
  achievements?: string | null;
  inventory?: string | null;
  socialLinks?: CoachSocialLink[];
  about?: string | null;
  coachingSince?: number | null;
}

/** Самый ранний год стажа — тот же предел держит CHECK `CoachCard_coaching_since_sane`. */
export const EARLIEST_COACHING_YEAR = 1950;

/** Отказ человеческими словами или `null` — год годится. Год из будущего — нет. */
export function coachingSinceProblem(year: number, today: Date = new Date()): string | null {
  if (!Number.isInteger(year) || year < EARLIEST_COACHING_YEAR || year > today.getFullYear()) {
    return `Год начала стажа — от ${EARLIEST_COACHING_YEAR} до ${today.getFullYear()}`;
  }

  return null;
}

/**
 * Стаж словами: «12 лет», «1 год», в год начала — «меньше года». Считается от
 * года на сегодня — и сам растёт каждый январь.
 */
export function coachingYearsLabel(since: number, today: Date = new Date()): string {
  const years = today.getFullYear() - since;

  if (years < 1) {
    return 'меньше года';
  }

  const mod10 = years % 10;
  const mod100 = years % 100;
  const word =
    mod10 === 1 && mod100 !== 11 ? 'год' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'года' : 'лет';

  return `${years} ${word}`;
}

/**
 * Цены тренера в ОДНОМ клубе, копейки. В соседнем клубе у того же человека
 * они другие, поэтому живут не в карточке, а у пары «тренер + клуб».
 */
export interface CoachPrices {
  groupPrice: number | null;
  individualPrice: number | null;
  /** Приписка к ценам: «первое занятие бесплатно». */
  priceNote: string | null;
}

export type UpdateCoachPricesRequest = CoachPrices;

/** Клуб в публичной карточке — вместе с ценами тренера в нём. */
export interface CoachClub extends CoachPrices {
  name: string;
  slug: string;
}

/**
 * Публичная страница тренера. Ни телефона, ни почты — и имя в том же виде,
 * что в списке мероприятий клуба: «Фамилия И.».
 *
 * Карточка одна, а клубов может быть несколько: они перечислены со своими
 * ценами, и адрес страницы клуба больше не несёт — карточка платформенная.
 */
export interface PublicCoach {
  id: string;
  name: string;
  photoFileId: string | null;
  /** Пол — для заглушки, когда фотографии нет. */
  gender: Gender | null;
  achievements: string | null;
  inventory: string | null;
  socialLinks: CoachSocialLink[];
  about: string | null;
  coachingSince: number | null;
  /** Разряд — как на странице игрока: отклонённого нет. */
  rank: PublicRank | null;
  /** Клубы, где человек тренирует, с ценами в каждом. */
  clubs: CoachClub[];
}

/** Тренер клуба в карточке человека у администратора: карточка плюс цены. */
export interface CoachInClub {
  card: CoachCard;
  prices: CoachPrices;
}

/**
 * Записавшийся в группу — так, как его видит тренер.
 *
 * Полное имя и телефон, а не «Фамилия И.»: тренеру нужно позвонить ученику,
 * и те же данные он видит в составе клуба. Ни статуса отметки, ни денег здесь
 * нет — это работа администратора на экране смены.
 */
export interface CoachGroupParticipant {
  userId: string;
  fullName: string;
  phone: string;
}

/** За какой срок считается статистика. «Всё время» — с первого занятия. */
export type CoachStatsPeriod = 30 | 90 | 365 | 0;

export const COACH_STATS_PERIODS: readonly CoachStatsPeriod[] = [30, 90, 365, 0];

/**
 * Статистика тренера по его занятиям.
 *
 * Считается по ЗАКОНЧИВШИМСЯ занятиям: у идущего сейчас отметок ещё нет, и
 * включать его значило бы занижать посещаемость ровно до вечера.
 *
 * Посещаемость считается только по отмеченным записям, а число неотмеченных
 * показывается рядом: без этого клуб, забывший отметить смену, выглядел бы у
 * тренера как день, когда никто не пришёл.
 */
export interface CoachStats {
  period: CoachStatsPeriod;
  /** Сколько занятий закончилось за срок. */
  sessions: number;
  /** Записей на них — вместе с отменёнными. */
  entries: number;
  attended: number;
  noShows: number;
  cancelled: number;
  /** Записи, по которым клуб не поставил отметку. */
  unmarked: number;
  /**
   * Доля пришедших среди отмеченных, 0..100. Пусто, когда отмечать было
   * нечего: ноль здесь читался бы как «никто не ходит».
   */
  attendanceRate: number | null;
  /** Сколько человек в среднем приходило на занятие. Пусто, если занятий нет. */
  averageAttendance: number | null;
  /** Средняя заполненность группы, 0..100: записей к местам. */
  averageFill: number | null;
}

/** Занятие тренера вместе с составом. */
export interface CoachGroup {
  id: string;
  /** Название типа тренировки: «Группа начинающих». */
  title: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  participants: CoachGroupParticipant[];
}
