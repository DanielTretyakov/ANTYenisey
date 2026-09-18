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
