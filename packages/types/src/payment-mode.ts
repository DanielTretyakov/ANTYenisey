/**
 * Как клиенты платят клубу — настройка клуба (решение владельца от
 * 26.10.2026), а не правило платформы. Отступает от ТЗ: там
 * зарегистрированный клиент платит только онлайн, а у стойки — лишь новичок
 * «с порога».
 *
 * - `ON_SITE` — на месте: у стойки наличными или картой;
 * - `ONLINE` — онлайн при записи;
 * - `HYBRID` — клиент выбирает при записи: онлайн или на месте. Политика
 *   отмены и неявки одна на оба способа.
 *
 * Значения совпадают с enum `ClientPaymentMode` из schema.prisma — при
 * добавлении способа править оба места.
 */
export const CLIENT_PAYMENT_MODES = ['ON_SITE', 'ONLINE', 'HYBRID'] as const;

export type ClientPaymentMode = (typeof CLIENT_PAYMENT_MODES)[number];

/**
 * Принимает ли платформа оплату клиентов онлайн. Пока нет: магазина ЮKassa
 * для клиентских платежей не подключено, и «онлайн» с «гибридом» выбрать
 * нельзя — клуб пообещал бы клиентам то, чего сайт не умеет. Станет `true`
 * вместе с самой оплатой, в том же изменении.
 */
export const ONLINE_CLIENT_PAYMENTS_READY = false;

/** Подпись способа в настройках клуба. */
export const PAYMENT_MODE_TITLE: Record<ClientPaymentMode, string> = {
  ON_SITE: 'На месте',
  ONLINE: 'Онлайн',
  HYBRID: 'Онлайн или на месте',
};

/** Как способ выглядит для клиента — строкой у цены. */
export const PAYMENT_MODE_NOTE: Record<ClientPaymentMode, string> = {
  ON_SITE: 'Оплата на месте — наличными или картой',
  ONLINE: 'Оплата онлайн при записи',
  HYBRID: 'Оплата онлайн при записи или на месте',
};

/** Можно ли сейчас выбрать способ. */
export function paymentModeAvailable(mode: ClientPaymentMode, onlineReady = ONLINE_CLIENT_PAYMENTS_READY): boolean {
  return mode === 'ON_SITE' || onlineReady;
}

/** Отказ человеческими словами или `null` — можно. */
export function paymentModeProblem(mode: ClientPaymentMode, onlineReady = ONLINE_CLIENT_PAYMENTS_READY): string | null {
  return paymentModeAvailable(mode, onlineReady)
    ? null
    : 'Онлайн-оплата для клиентов ещё не подключена — пока доступна только оплата на месте';
}
