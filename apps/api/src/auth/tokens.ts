import { createHash } from 'node:crypto';

/**
 * Чистые функции работы с токенами.
 *
 * Вынесены из AuthService намеренно: сервис увешан декораторами Nest, и
 * импортировать его в тест — значит тянуть за собой весь контейнер внедрения
 * зависимостей ради двух функций без состояния.
 */

/**
 * Refresh-токены хешируются быстрым SHA-256, а не argon2, и это осознанно:
 * токен — 256 случайных бит, перебирать его нечем, а argon2 на каждом
 * обновлении пары стоил бы 19 МиБ памяти на запрос.
 */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

const DURATION_MULTIPLIERS = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
} as const;

/** Разбор строк вида `15m`, `30d`, `12h`, `45s` в миллисекунды. */
export function parseDuration(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());

  if (!match) {
    throw new Error(`Некорректная длительность: «${value}». Ожидается вид 15m, 12h, 30d`);
  }

  const amount = Number(match[1]);
  const unit = match[2] as keyof typeof DURATION_MULTIPLIERS;

  return amount * DURATION_MULTIPLIERS[unit];
}
