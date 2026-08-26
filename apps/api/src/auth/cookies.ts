import type { CookieOptions } from 'express';

/**
 * Транспорт refresh-токена.
 *
 * Токен уезжает в httpOnly-куке, а не в теле ответа: в `localStorage` он
 * читается любым скриптом на странице, то есть одна XSS отдаёт злоумышленнику
 * доступ к учётке на все 30 дней. Куку с `httpOnly` JavaScript не видит.
 *
 * Тот же API обслуживает будущее мобильное приложение (Capacitor), где кук
 * нет, поэтому тело ответа остаётся доступным — но только по явному запросу
 * клиента (см. `wantsBodyTransport`). Браузер такого заголовка не шлёт и
 * получает токен исключительно в куке.
 *
 * Здесь только чистые функции: сервисы Nest увешаны декораторами, и тянуть их
 * в тест — значит тянуть весь контейнер внедрения зависимостей.
 */

/** Имя куки с refresh-токеном. */
export const REFRESH_COOKIE = 'yenisey_refresh';

/**
 * Кука ограничена ветвью авторизации: на остальные маршруты API она не
 * отправляется вовсе, и утечь из них не может. `/api/auth` — с учётом
 * глобального префикса `api`.
 */
const REFRESH_COOKIE_PATH = '/api/auth';

/** Заголовок, которым клиент без кук просит отдать токен в теле ответа. */
export const TRANSPORT_HEADER = 'x-auth-transport';

/**
 * Параметры куки.
 *
 * `sameSite: 'lax'` — защита от CSRF: браузер не приложит куку к POST-запросу,
 * инициированному чужим сайтом, а значит `/auth/refresh` нельзя дёрнуть с
 * постороннего домена. Веб и API живут на разных портах, но `SameSite` считает
 * порт незначимым (сравниваются регистрируемые домены), поэтому пара
 * `localhost:3000` → `localhost:3001` остаётся same-site и в разработке.
 *
 * `secure` включается только в production: в разработке всё ходит по http, и
 * браузер такую куку просто не сохранил бы.
 */
export function refreshCookieOptions(maxAgeMs: number, secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAgeMs,
  };
}

/**
 * Параметры для гашения куки при выходе.
 *
 * Браузер удаляет куку только когда совпадают имя, путь и остальные атрибуты,
 * поэтому набор обязан повторять выданный — отличается лишь срок жизни.
 */
export function clearedCookieOptions(secure: boolean): CookieOptions {
  return { ...refreshCookieOptions(0, secure), maxAge: undefined, expires: new Date(0) };
}

/**
 * Просит ли клиент отдать refresh-токен в теле ответа.
 *
 * Значение по умолчанию — «нет»: незнакомый клиент получает куку, а не токен
 * в теле. Ошибиться в сторону безопасного варианта дешевле.
 */
export function wantsBodyTransport(header: string | string[] | undefined): boolean {
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim().toLowerCase() === 'body';
}
