/**
 * Карточка тренера: фотография, достижения, инвентарь, стоимость, соцсети.
 *
 * В отличие от профиля игрока карточка принадлежит КЛУБУ, а не человеку:
 * ключ — пара «человек + клуб». Один тренер в двух клубах ведёт две карточки,
 * и цена за тренировку в них разная.
 */

/** Ссылка на соцсеть: подпись и адрес. Каталога сетей нет — их слишком много. */
export interface CoachSocialLink {
  label: string;
  url: string;
}

/** Больше десяти ссылок — это уже не «контакты», а список ссылок. */
export const MAX_COACH_SOCIAL_LINKS = 10;

/** Карточка так, как её правят: сам тренер или администратор его клуба. */
export interface CoachProfile {
  userId: string;
  photoFileId: string | null;
  achievements: string | null;
  inventory: string | null;
  priceInfo: string | null;
  socialLinks: CoachSocialLink[];
}

/** Поле не прислано — не трогается; прислано пустым — стирается. */
export interface UpdateCoachProfileRequest {
  achievements?: string | null;
  inventory?: string | null;
  priceInfo?: string | null;
  socialLinks?: CoachSocialLink[];
}

/** Клуб в публичной карточке: по slug открывается его страница. */
export interface CoachClub {
  name: string;
  slug: string;
}

/**
 * Публичная страница тренера. Ни телефона, ни почты — и имя в том же виде,
 * что в списке мероприятий клуба: «Фамилия И.».
 */
export interface PublicCoach {
  id: string;
  name: string;
  photoFileId: string | null;
  achievements: string | null;
  inventory: string | null;
  priceInfo: string | null;
  socialLinks: CoachSocialLink[];
  /** Клуб, чья карточка показана. */
  club: CoachClub;
  /** Остальные клубы, где этот человек тренирует. Обычно пусто. */
  otherClubs: CoachClub[];
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
