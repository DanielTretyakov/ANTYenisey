import { z } from 'zod';

/**
 * Схема переменных окружения. Валидируется один раз при старте: приложение
 * должно падать сразу с внятной ошибкой, а не через неделю на проде, когда
 * забытый JWT_ACCESS_SECRET окажется `undefined` и токены станут подписываться
 * пустой строкой.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().url(),
    // 32 символа — не формальность: секрет короче реально перебирается по
    // радужным таблицам HMAC-SHA256.
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('30d'),
    API_PORT: z.coerce.number().int().positive().default(3001),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    // Сколько неудачных попыток входа подряд допускается для одной учётки и за
    // какое время счётчик забывается. Считаются только провалы, ключ — «клуб +
    // почта», см. auth/attempt-limiter.ts.
    AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(10),
    AUTH_ATTEMPT_WINDOW: z.string().default('15m'),
    // Грубое ограничение частоты на весь API — защита от заваливания
    // запросами, а не от подбора пароля.
    RATE_LIMIT: z.coerce.number().int().positive().default(120),
    RATE_LIMIT_WINDOW: z.string().default('1m'),
  })
  .refine((env) => env.JWT_ACCESS_SECRET !== env.JWT_REFRESH_SECRET, {
    // Совпадение секретов означает, что refresh-токен примут как access:
    // подпись сойдётся, и долгоживущий токен обойдёт короткий срок жизни.
    message: 'JWT_ACCESS_SECRET и JWT_REFRESH_SECRET должны различаться',
    path: ['JWT_REFRESH_SECRET'],
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Некорректное окружение — проверьте .env:\n${details}`);
  }

  return parsed.data;
}

/** Источники для CORS: в .env хранятся строкой через запятую. */
export function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
