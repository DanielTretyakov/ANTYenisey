/**
 * Правила заявки клуба на подключение (решение владельца от 03.10.2026).
 *
 * Чистый модуль без относительных импортов — гоняется `node --test`.
 */

export interface ApplicationContacts {
  phone?: string | null;
  email?: string | null;
}

/**
 * Заполнено ли поле-ловушка. Человек его не видит (оно спрятано в форме и
 * пропущено при обходе клавиатурой), бот заполняет всё подряд.
 */
export function isBotSubmission(website: string | undefined | null): boolean {
  return typeof website === 'string' && website.trim().length > 0;
}

/** Почему заявку не принять — или null. Ответить без контакта заявителю нечем. */
export function contactsProblem(contacts: ApplicationContacts): string | null {
  const phone = contacts.phone?.trim() ?? '';
  const email = contacts.email?.trim() ?? '';

  return phone === '' && email === '' ? 'Оставьте телефон или почту — иначе нам не с кем связаться' : null;
}

/** Пустая строка формы — «не указано», а не значение. */
export function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';

  return trimmed === '' ? null : trimmed;
}
