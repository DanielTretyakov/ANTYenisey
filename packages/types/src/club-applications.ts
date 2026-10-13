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
   * Присылать новости КНТ для клубов на почту (12.10.2026) — отдельная
   * неотмеченная галочка: реклама только с согласия (38-ФЗ).
   */
  newsConsent?: boolean;
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
  /** Город из справочника — его подставляет форма заведения клуба. */
  cityId: string | null;
  phone: string | null;
  email: string | null;
  halls: number | null;
  tables: number | null;
  comment: string | null;
  status: ClubApplicationStatus;
  note: string | null;
  /** Клуб, заведённый по заявке (11.10.2026); пусто — ещё не заведён. */
  club: { slug: string; name: string } | null;
}

export interface ClubApplicationUpdate {
  status: ClubApplicationStatus;
  note: string | null;
}

/**
 * Владелец платформы заводит клуб (решения владельца от 11.10.2026): клуб
 * появляется черновиком, руководитель — уже зарегистрированная учётка по
 * почте (учёток за людей мы не заводим). Из заявки — с её ссылкой.
 */
export interface ClubCreateRequest {
  name: string;
  /** Код клуба для адреса: строчная латиница и цифры через дефис, 3–40 знаков. */
  slug: string;
  cityId: string;
  ownerEmail: string;
  applicationId?: string;
}

/** Код клуба — то же правило, что у CHECK `Tenant_slug_format`. */
export const CLUB_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Открытие клуба: открыт ли, и что ещё нужно, чтобы открыть. Открывает
 * руководитель клуба (или владелец платформы), когда список пуст.
 */
export interface ClubOpening {
  publishedAt: string | null;
  /** Чего не хватает: «Заведите зал», «У зала «Пироги» нет адреса»… */
  problems: string[];
}
