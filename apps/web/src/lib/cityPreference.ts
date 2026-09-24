/**
 * Город поиска на стартовой — запомненный в этом браузере.
 *
 * Удобство, а не данные: потерялся (приватный режим, чистка сайта) — страница
 * просто снова предложит Красноярск. Поэтому localStorage в try/catch, как у
 * темы, а не сервер.
 */
const KEY = 'yenisey.city';

/** Выбрано «Любой город» — отдельное значение, чтобы не подставлять Красноярск снова. */
export const ANY_CITY = 'any';

/** Город по умолчанию — домашний город платформы (решение владельца от 24.09.2026). */
export const DEFAULT_CITY = { name: 'Красноярск', region: 'Красноярский край' } as const;

export function readCityPreference(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveCityPreference(value: string): void {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* не страшно: выбор проживёт до перезагрузки */
  }
}
