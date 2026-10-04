'use client';

import type { AuthResponse } from '@yenisey/types';

/**
 * Сессия на клиенте.
 *
 * Access-токен живёт только в памяти вкладки — ни в localStorage, ни в куке,
 * доступной скриптам. Любой скрипт на странице читает localStorage целиком,
 * поэтому одна XSS означала бы кражу токена; из замыкания модуля его так
 * просто не достать, а перезагрузка страницы всё равно его стирает.
 *
 * Refresh-токен сюда не попадает вовсе: он приезжает в httpOnly-куке, которую
 * JavaScript не видит, и уходит обратно автоматически — браузер прикладывает
 * её к запросам на /api/auth сам (см. `credentials: 'include'` в lib/api.ts).
 *
 * Отсюда следствие: после перезагрузки страницы access-токена нет, и его надо
 * восстановить обменом refresh-куки — этим занимается `restoreSession`.
 */
let accessToken: string | null = null;

/**
 * Пометка «в этом браузере не вошли» (аудит 03.10.2026). Без неё каждая
 * страница гостя пробовала обменять куку, которой нет, и получала 401 —
 * красной строкой в консоли у каждого посетителя. Пометка — только подсказка:
 * токена в ней нет, а вход, регистрация и удачный обмен её снимают. Нет
 * пометки (первый визит, старая сессия) — обмен пробуется, как раньше.
 */
const SIGNED_OUT_KEY = 'knt.signed-out';

function markSignedOut(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(SIGNED_OUT_KEY, '1');
    else window.localStorage.removeItem(SIGNED_OUT_KEY);
  } catch {
    // Хранилище закрыто — обмен просто будет пробоваться, как раньше.
  }
}

/** Браузер помнит, что здесь не вошли, — обменивать куку незачем. */
export function knownSignedOut(): boolean {
  try {
    return window.localStorage.getItem(SIGNED_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveSession(auth: AuthResponse): void {
  accessToken = auth.accessToken;
  markSignedOut(false);
}

export function readAccessToken(): string | null {
  return accessToken;
}

/** Сессии нет: выход или кука не обменялась. */
export function clearSession(): void {
  accessToken = null;
  markSignedOut(true);
}

/** Токен из памяти — прочь, но без пометки «не вошли»: сессия, может быть, жива. */
export function forgetToken(): void {
  accessToken = null;
}
