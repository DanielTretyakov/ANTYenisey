/**
 * Оператор платформы — кто стоит за КНТ: для подвала, документов, страницы
 * «Подключить клуб» (аудит 03.10.2026: оператор не был указан нигде).
 *
 * Пока заглушка (решение владельца от 03.10.2026): пустое поле показывается
 * как «уточняется». Заполнить — здесь одним местом; те же сведения нужны
 * серверу для счетов (`BILLING_SELLER_*` в окружении API).
 */
export const OPERATOR: {
  name: string | null;
  inn: string | null;
  address: string | null;
  email: string | null;
} = {
  name: null,
  inn: null,
  address: null,
  email: null,
};

export const PENDING = 'уточняется';

/** «ИП Иванов И. И., ИНН …» — или пометка, что сведения уточняются. */
export function operatorLine(): string {
  if (!OPERATOR.name) return `Оператор: ${PENDING}`;

  return `${OPERATOR.name}${OPERATOR.inn ? `, ИНН ${OPERATOR.inn}` : ''}`;
}
