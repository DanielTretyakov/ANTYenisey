/**
 * Абонементы клиента.
 *
 * Абонемент — пакет визитов (или безлимит) на срок, покрывающий выбранные
 * клубом типы занятий и турниров. Продаёт администратор у стойки; онлайн-
 * покупка появится вместе с платёжным шлюзом (решения владельца от 19.09.2026).
 */

/** Тариф так, как его видит и правит администратор. */
export interface SubscriptionPlan {
  id: string;
  name: string;
  /** Сколько визитов; null — безлимит. */
  visitsCount: number | null;
  /** Срок в днях до конца местного дня последнего из них; null — бессрочно. */
  durationDays: number | null;
  /** Цена, копейки. */
  price: number;
  isActive: boolean;
  trainingTypeIds: string[];
  tournamentTypeIds: string[];
  /**
   * Сколько абонементов этого тарифа сейчас действует. Пока их больше нуля,
   * убрать услугу из покрытия нельзя — только добавить.
   */
  activeSubscriptions: number;
}

export interface SubscriptionPlanRequest {
  name: string;
  visitsCount: number | null;
  durationDays: number | null;
  price: number;
  isActive?: boolean;
  trainingTypeIds: string[];
  tournamentTypeIds: string[];
}

/** Абонемент клиента — в карточке человека и в кабинете самого клиента. */
export interface ClientSubscription {
  id: string;
  club: { name: string; slug: string };
  planName: string;
  /** Остаток визитов; null — безлимит. */
  remainingVisits: number | null;
  purchasedAt: string;
  /** Первая минута, когда абонемент уже не действует; null — бессрочный. */
  expiresAt: string | null;
  /** Цена на момент продажи, копейки. */
  priceAtPurchase: number;
  /** Действует ли сейчас: срок не истёк и визиты есть. */
  active: boolean;
  /** Что покрывает — названиями, как их видит клиент. */
  covers: string[];
}

export type LedgerReasonView = 'PURCHASE' | 'VISIT_CHARGED' | 'VISIT_REFUNDED' | 'ADMIN_ADJUSTMENT';

/** Движение по абонементу — строка истории. */
export interface SubscriptionLedgerRow {
  id: string;
  at: string;
  delta: number;
  /** Остаток после движения; null у безлимита. */
  balanceAfter: number | null;
  reason: LedgerReasonView;
  /** Причина ручной корректировки. */
  note: string | null;
  /** Кто сделал: продавец или администратор. У движений по записи пусто. */
  by: string | null;
  /** За какое мероприятие — у списаний и возвратов. */
  entry: { title: string; startsAt: string } | null;
}

export interface IssueSubscriptionRequest {
  planId: string;
}

/**
 * Ручное действие с абонементом: корректировка визитов (`delta`) или
 * досрочное закрытие безлимита (`close`). Причина обязательна в обоих.
 */
export interface AdjustSubscriptionRequest {
  delta?: number;
  close?: boolean;
  reason: string;
}

/** Чем оплачена запись, если не деньгами. */
export interface PaidBySubscription {
  subscriptionId: string;
  planName: string;
}
