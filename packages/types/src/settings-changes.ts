/**
 * Отложенные правки настроек клуба (решение владельца от 26.09.2026).
 *
 * Всё со страницы «Настройки» — клуб, залы, столы — вступает в силу в
 * ближайшие 00:00 по поясу зала, а не посреди рабочего дня. Сразу меняется
 * только оформление страницы клуба: описание, ценности, логотип, цвет, баннер
 * и тренерский состав.
 */

export type SettingsChangeKind =
  | 'CLUB'
  | 'HALL_CREATE'
  | 'HALL_UPDATE'
  | 'HALL_DELETE'
  | 'TABLE_CREATE'
  | 'TABLE_RENAME'
  | 'TABLE_DELETE';

export type SettingsChangeStatus = 'PENDING' | 'APPLIED' | 'CANCELLED' | 'FAILED';

export interface SettingsChange {
  id: string;
  kind: SettingsChangeKind;
  /** Зал или стол; у правки клуба — null. У создания — будущий id. */
  targetId: string | null;
  /** Зал, к которому относится правка (у стола — его зал); у клуба — null. */
  hallId: string | null;
  /**
   * Новое название: стола — у создания и переименования, зала — у создания.
   * По нему настройки показывают будущий стол строкой «появится в 00:00».
   */
  newName: string | null;
  /** Что меняется, по строке: «Час аренды: 400 ₽ → 450 ₽». */
  summary: string[];
  /** «Иванов И.». */
  authorName: string;
  createdAt: string;
  /** Ближайшая полночь по поясу зала (у клуба — старшего зала). */
  effectiveAt: string;
  /**
   * Она же для человека — «27 сентября в 00:00» по поясу зала, а не
   * браузера: администратор в другом поясе иначе увидел бы «04:00».
   */
  effectiveLabel: string;
  status: SettingsChangeStatus;
  /** Когда применена, отменена или не применилась. */
  resolvedAt: string | null;
  /** Кто отменил — «Петров П.». */
  cancelledByName: string | null;
  /** Почему не применилась: «У стола есть брони…». */
  failure: string | null;
}

/**
 * Поля настроек клуба, которые меняются сразу: это оформление страницы, а не
 * правила работы. Остальное ждёт полуночи.
 */
export const IMMEDIATE_CLUB_FIELDS = ['description', 'values', 'logoUrl', 'accentColor'] as const;

/** Сколько столов можно завести вместе с новым залом. */
export const MAX_TABLES_WITH_HALL = 40;
