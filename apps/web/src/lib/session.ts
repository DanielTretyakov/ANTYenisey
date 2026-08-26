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

export function saveSession(auth: AuthResponse): void {
  accessToken = auth.accessToken;
}

export function readAccessToken(): string | null {
  return accessToken;
}

export function clearSession(): void {
  accessToken = null;
}
