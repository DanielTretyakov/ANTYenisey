/**
 * Заявки клубов на подключение к КНТ — форма страницы «Подключить свой клуб»
 * (решение владельца от 03.10.2026). Оставить её можно без входа; ведёт её
 * владелец платформы на «Клубах и подписках».
 */

export type ClubApplicationStatus = 'NEW' | 'IN_PROGRESS' | 'CONNECTED' | 'DECLINED';

export const CLUB_APPLICATION_STATUSES: ClubApplicationStatus[] = ['NEW', 'IN_PROGRESS', 'CONNECTED', 'DECLINED'];

export const CLUB_APPLICATION_STATUS_LABELS: Record<ClubApplicationStatus, string> = {
  NEW: 'новая',
  IN_PROGRESS: 'в работе',
  CONNECTED: 'подключён',
  DECLINED: 'отказ',
};

/** Что отправляет форма. Телефон или почта — хотя бы одно. */
export interface ClubApplicationRequest {
  contactName: string;
  clubName: string;
  /** Город из справочника (`CityCombobox`). */
  cityId?: string | null;
  /** +79991234567. */
  phone?: string | null;
  email?: string | null;
  halls?: number | null;
  tables?: number | null;
  comment?: string | null;
  /** Согласие на обработку персональных данных — имя и контакт заявителя (152-ФЗ). */
  consent: true;
  /**
   * Поле-ловушка для ботов: в форме оно спрятано, человек его не видит и не
   * заполняет. Заполненное — заявка «принимается» и молча не сохраняется.
   */
  website?: string;
}

/** Заявка в списке владельца платформы. */
export interface ClubApplicationView {
  id: string;
  createdAt: string;
  contactName: string;
  clubName: string;
  /** «Красноярск, Красноярский край». */
  city: string | null;
  phone: string | null;
  email: string | null;
  halls: number | null;
  tables: number | null;
  comment: string | null;
  status: ClubApplicationStatus;
  note: string | null;
}

export interface ClubApplicationUpdate {
  status: ClubApplicationStatus;
  note: string | null;
}
