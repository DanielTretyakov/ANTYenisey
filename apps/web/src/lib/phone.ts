/**
 * Телефон для чтения: «+73912000000» → «+7 391 200-00-00» — так же, как его
 * показывает поле ввода (`PhoneField`). Хранится и уходит в `tel:` — E.164;
 * что не похоже на российский номер, показывается как есть.
 */
export function formatPhone(phone: string): string {
  const match = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);

  return match ? `+7 ${match[1]} ${match[2]}-${match[3]}-${match[4]}` : phone;
}
