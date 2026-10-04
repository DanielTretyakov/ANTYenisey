/**
 * Подписка клуба на КНТ — деньги «клуб → платформа» (ТЗ → «Монетизация
 * платформы», решения владельца от 02.10.2026). Не путать с абонементом
 * клиента: тот — деньги «клиент → клуб».
 */

export type PlatformStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'EXEMPT';
export type PlatformPaymentMethodName = 'CARD' | 'INVOICE';
export type PlatformPaymentStatusName = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

/** Пробный период нового клуба, дней. */
export const PLATFORM_TRIAL_DAYS = 7;
/** Сколько дней клуб работает после неудачного списания, прежде чем доступ закроется. */
export const PLATFORM_GRACE_DAYS = 3;
/** За сколько дней до конца срока руководителю приходит напоминание. */
export const PLATFORM_REMINDER_DAYS = [7, 1] as const;

export interface PlatformPlanView {
  id: string;
  name: string;
  periodMonths: number;
  /** Копейки. */
  price: number;
  /** В пересчёте на месяц, копейки, округлено до рубля. */
  perMonth: number;
  /** Выгода против помесячной оплаты, целые проценты; у месячного — 0. */
  savingPercent: number;
}

export interface PlatformActView {
  id: string;
  number: number;
  periodFrom: string;
  periodTo: string;
  amount: number;
}

export interface PlatformPaymentView {
  id: string;
  createdAt: string;
  method: PlatformPaymentMethodName;
  status: PlatformPaymentStatusName;
  amount: number;
  planName: string;
  autoCharge: boolean;
  invoiceNumber: number | null;
  periodFrom: string | null;
  periodTo: string | null;
  paidAt: string | null;
  failureReason: string | null;
  acts: PlatformActView[];
}

export interface ClubRequisitesView {
  legalName: string;
  inn: string;
  kpp: string | null;
  address: string;
  email: string;
}

/** Страница «Подписка на КНТ» руководителя клуба. */
export interface BillingView {
  status: PlatformStatus;
  planName: string | null;
  trialEndsAt: string | null;
  paidUntil: string | null;
  /** До какого момента клуб работает при просрочке. */
  graceUntil: string | null;
  suspendedAt: string | null;
  autoRenew: boolean;
  /** «Visa •• 4242» — сохранённая карта. */
  paymentMethodTitle: string | null;
  /** Следующее автосписание: когда и сколько. Нет карты или автопродления — null. */
  nextCharge: { at: string; amount: number } | null;
  plans: PlatformPlanView[];
  payments: PlatformPaymentView[];
  requisites: ClubRequisitesView | null;
  /** Оплата картой на сервере подключена (ЮKassa или поддельная вне production). */
  cardAvailable: boolean;
}

/** Начало оплаты картой: на эту страницу ЮKassa уходит руководитель. */
export interface CardPaymentStart {
  paymentId: string;
  confirmationUrl: string;
}

/** Документ для печати: счёт или акт, с реквизитами сторон. */
export interface PlatformDocument {
  kind: 'INVOICE' | 'ACT';
  number: number;
  date: string;
  amount: number;
  /** Что оплачено: «Доступ к платформе КНТ, тариф «Год», 02.10.2026 — 02.10.2027». */
  subject: string;
  buyer: ClubRequisitesView & { club: string };
  /** Реквизиты платформы — из настроек сервера; не заданы — null, документ так и пишет. */
  seller: PlatformSeller | null;
}

export interface PlatformSeller {
  name: string;
  inn: string;
  kpp: string | null;
  address: string;
  bank: string | null;
  bik: string | null;
  account: string | null;
  corrAccount: string | null;
}

/** Строка списка «Клубы и подписки» владельца платформы. */
export interface PlatformClubRow {
  slug: string;
  name: string;
  status: PlatformStatus;
  planName: string | null;
  trialEndsAt: string | null;
  paidUntil: string | null;
  graceUntil: string | null;
  paymentMethodTitle: string | null;
  /** Выставленный и ещё не оплаченный счёт — его владелец отмечает оплаченным. */
  pendingInvoice: { paymentId: string; number: number; amount: number } | null;
}

/** Помесячная цена и выгода тарифа — одна на страницу и на сервер. */
export function planEconomics(
  plan: { periodMonths: number; price: number },
  monthPrice: number | null,
): { perMonth: number; savingPercent: number } {
  const perMonth = Math.round(plan.price / plan.periodMonths / 100) * 100;
  const full = monthPrice === null ? null : monthPrice * plan.periodMonths;
  const savingPercent = full && full > plan.price ? Math.round(((full - plan.price) / full) * 100) : 0;

  return { perMonth, savingPercent };
}
