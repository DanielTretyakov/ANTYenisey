/**
 * Уведомления: что человек видит и настраивает в личном кабинете.
 *
 * Список категорий повторяет enum NotificationCategory из схемы, кроме
 * SERVICE: служебное (проверочное сообщение) не выключается, и в настройках
 * его нет.
 */
export type NotificationCategoryName =
  | 'MY_BOOKINGS'
  | 'MY_SUBSCRIPTION'
  | 'COACH_GROUPS'
  | 'CLUB_ALERTS'
  | 'CLUB_DIGEST'
  | 'PLATFORM_DIGEST';

export interface NotificationCategorySetting {
  category: NotificationCategoryName;
  enabled: boolean;
}

/** Привязка к боту в мессенджере MAX. */
export interface MaxLinkState {
  /** Бот настроен на сервере. Нет — подключать нечего, кнопку не показываем. */
  available: boolean;
  linked: boolean;
  linkedAt: string | null;
  /** Человек остановил бота: сообщения не доходят, пока он не запустит его снова. */
  blocked: boolean;
}

export interface NotificationSettingsView {
  max: MaxLinkState;
  /** Только категории, которые подходят ролям человека. */
  categories: NotificationCategorySetting[];
}

/** Ссылка на бота с одноразовым токеном привязки. */
export interface MaxLinkResponse {
  url: string;
  expiresAt: string;
}
