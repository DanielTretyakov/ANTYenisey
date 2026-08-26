import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clearedCookieOptions,
  refreshCookieOptions,
  wantsBodyTransport,
} from './cookies.ts';

test('кука с refresh-токеном недоступна скриптам и не уходит на чужие сайты', () => {
  const options = refreshCookieOptions(2_592_000_000, true);

  // httpOnly — весь смысл переезда из localStorage: XSS не должна прочитать
  // токен, живущий 30 дней.
  assert.equal(options.httpOnly, true);
  // SameSite=Lax закрывает CSRF на /auth/refresh: браузер не приложит куку к
  // POST-запросу, инициированному посторонним сайтом.
  assert.equal(options.sameSite, 'lax');
  assert.equal(options.secure, true);
  // Путь сужен до ветви авторизации: на остальные маршруты кука не ходит.
  assert.equal(options.path, '/api/auth');
  assert.equal(options.maxAge, 2_592_000_000);
});

test('вне production кука выдаётся без Secure — иначе браузер её не сохранит по http', () => {
  assert.equal(refreshCookieOptions(1000, false).secure, false);
});

test('гашение куки повторяет её атрибуты, иначе браузер не найдёт что удалять', () => {
  const issued = refreshCookieOptions(1000, true);
  const cleared = clearedCookieOptions(true);

  assert.equal(cleared.path, issued.path);
  assert.equal(cleared.sameSite, issued.sameSite);
  assert.equal(cleared.httpOnly, issued.httpOnly);
  assert.equal(cleared.secure, issued.secure);
  assert.deepEqual(cleared.expires, new Date(0));
});

test('токен в теле отдаётся только по явному запросу клиента', () => {
  assert.equal(wantsBodyTransport('body'), true);
  assert.equal(wantsBodyTransport('  BODY  '), true);
  // Заголовок может прийти массивом, если продублирован в запросе.
  assert.equal(wantsBodyTransport(['body']), true);
});

test('умолчание — безопасный вариант: незнакомый клиент получает только куку', () => {
  assert.equal(wantsBodyTransport(undefined), false);
  assert.equal(wantsBodyTransport(''), false);
  assert.equal(wantsBodyTransport('cookie'), false);
  assert.equal(wantsBodyTransport('bodyx'), false);
});
