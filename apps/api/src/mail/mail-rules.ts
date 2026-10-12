import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Правила почты (решения владельца от 12.10.2026) — чистые функции под
 * тестами; относительных импортов нет, см. CLAUDE.md.
 */

/** Почта к хранению и сравнению: без пробелов по краям и строчными. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Что известно об адресате письма в момент отправки. */
export interface Recipient {
  /** Учётка адресата: есть у всех, кроме заявителя клуба. */
  user: { email: string; emailVerifiedAt: Date | null; newsEmailConsentAt: Date | null; deactivatedAt: Date | null } | null;
  /** Отписки и «не доставляется» по этому адресу. */
  suppressed: readonly ('ALL' | 'NEWS')[];
}

/**
 * Почему письмо не уходит — словами для журнала, или `null`, если уходит.
 *
 * Проверяется при отправке, а не только при постановке: между ними человек
 * мог отписаться, сменить почту или снять согласие.
 */
export function sendProblem(audience: 'any' | 'verified' | 'news', to: string, recipient: Recipient): string | null {
  if (recipient.suppressed.includes('ALL')) {
    return 'адрес в списке «не писать»';
  }

  if (audience === 'news' && recipient.suppressed.includes('NEWS')) {
    return 'адресат отписался от рассылки';
  }

  const { user } = recipient;

  if (!user) {
    // Без учётки — только заявитель клуба; его согласие проверено при
    // постановке, отписка — выше.
    return null;
  }

  if (user.deactivatedAt) {
    return 'учётка отключена';
  }

  if (normalizeEmail(user.email) !== to) {
    // Почту сменили после постановки письма — старой не пишем.
    return 'почта учётки сменилась';
  }

  if (audience === 'any') {
    return null;
  }

  if (!user.emailVerifiedAt) {
    return 'почта не подтверждена';
  }

  if (audience === 'news' && !user.newsEmailConsentAt) {
    return 'нет согласия на рассылку';
  }

  return null;
}

/**
 * Ссылка отписки — подписанная, без входа: человек нажимает её из почтовика,
 * часто на телефоне, где он не вошёл. Подпись — HMAC от адреса и вида, иначе
 * подставив чужую почту, можно было бы отписать кого угодно.
 */
export function signUnsubscribe(email: string, scope: 'NEWS', key: string): string {
  const body = Buffer.from(`${normalizeEmail(email)}|${scope}`).toString('base64url');

  return `${body}.${signature(body, key)}`;
}

export function verifyUnsubscribe(token: string, key: string): { email: string; scope: 'NEWS' } | null {
  const [body, given] = token.split('.');

  if (!body || !given) return null;

  const expected = signature(body, key);
  const a = Buffer.from(given);
  const b = Buffer.from(expected);

  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const [email, scope] = Buffer.from(body, 'base64url').toString('utf8').split('|');

  return email && scope === 'NEWS' ? { email, scope } : null;
}

function signature(body: string, key: string): string {
  return createHmac('sha256', key).update(`unsubscribe:${body}`).digest('base64url').slice(0, 32);
}
