'use client';

import type { AuthResponse } from '@yenisey/types';

/**
 * Хранение токенов на клиенте.
 *
 * Пока — localStorage, и это временное решение каркаса: localStorage читается
 * любым скриптом на странице, то есть XSS сразу отдаёт злоумышленнику
 * refresh-токен на 30 дней. Штатный вариант для веба — httpOnly-кука на
 * refresh и access только в памяти; переезд запланирован до подключения
 * платежей, когда у сессии появится реальная денежная цена.
 *
 * Здесь же причина, по которой API отдаёт refresh-токен в теле ответа, а не
 * только в куке: тот же бэкенд будет обслуживать мобильное приложение.
 */
const ACCESS_KEY = 'yenisey.accessToken';
const REFRESH_KEY = 'yenisey.refreshToken';

export function saveSession(auth: AuthResponse): void {
  localStorage.setItem(ACCESS_KEY, auth.accessToken);
  localStorage.setItem(REFRESH_KEY, auth.refreshToken);
}

export function readAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function readRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function clearSession(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}
