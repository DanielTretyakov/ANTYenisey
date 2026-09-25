/**
 * Семья: родитель ведёт ребёнка младше 14.
 *
 * Расширение сверх ТЗ по решениям владельца от 12.09 и 17.09.2026. Учётки у
 * родителя и ребёнка свои — с почтой и паролем. Пока ребёнку нет 14, родитель
 * записывает и отменяет за него, видит историю и ведёт профиль игрока; ребёнок
 * только смотрит.
 */
import type { RegisterRequest } from './auth';

/** Ребёнок в кабинете родителя. Родителю видно всё — учётку он и заводил. */
export interface FamilyChild {
  id: string;
  fullName: string;
  email: string;
  /** «2015-06-01». */
  birthDate: string;
  /** День четырнадцатилетия — дальше человек записывается сам. «2031-06-01». */
  guardianUntil: string;
}

/** Учётка ребёнка: всё как при регистрации, только без клуба. */
export type CreateChildRequest = Omit<RegisterRequest, 'tenantSlug'>;

export interface AttachChildRequest {
  email: string;
}

export interface ChildPasswordRequest {
  password: string;
}

/**
 * Ответ на заявку по почте — одинаковый при любом исходе.
 *
 * Иначе по ответам можно было бы перебрать почты и узнать, какие из них
 * принадлежат детям младше 14.
 */
export interface FamilyNotice {
  message: string;
}

/** Заявка в кабинете ребёнка: «Вас хочет закрепить Иванов И.». */
export interface GuardianshipRequestView {
  id: string;
  /** «Фамилия И.» заявителя. */
  guardianName: string;
  createdAt: string;
}

/** Кто ведёт человека сейчас. Пусто — никто, или ему уже 14. */
export interface MyGuardian {
  /** «Фамилия И.». */
  name: string;
}

/** Человек из семьи в карточке у администратора. */
export interface FamilyMember {
  id: string;
  /**
   * Полное имя — если человек состоит в этом клубе, иначе «Фамилия И.»: чужой
   * клуб полных имён не видит, как и при поиске человека у стойки.
   */
  name: string;
  /** «2015-06-01». */
  birthDate: string;
  /** Состоит в этом клубе — тогда на него есть карточка. */
  memberOfClub: boolean;
}

/** Семья в карточке человека у администратора. */
export interface ClubPersonFamily {
  /** Человеку нет 14: записывает за него родитель. */
  isChild: boolean;
  /** Человеку есть 18: может вести ребёнка. */
  canBeGuardian: boolean;
  /** Кто ведёт человека — если он ребёнок и закреплён. */
  guardian: FamilyMember | null;
  /** Кого ведёт человек. */
  children: FamilyMember[];
}

/** Администратор предлагает закрепить ребёнка за родителем — подтвердит ребёнок. */
export interface AttachGuardianRequest {
  guardianId: string;
}

/** Клуб снимает закрепление — только с причиной. */
export interface RevokeGuardianshipRequest {
  reason: string;
}
