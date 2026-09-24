import { z } from 'zod';
import { parseDuration } from '../auth/tokens';

/**
 * Необязательная переменная, где пустая строка — это «не задано».
 *
 * compose передаёт незаполненное `MAX_BOT_TOKEN=` пустой строкой, а не
 * отсутствием, и без этого API на стенде падал бы на старте из-за поля,
 * которое заполнять и не собирались.
 */
function optional<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
}

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
    // Джоба автонеявки: через сутки после окончания неотмеченная запись
    // становится неявкой со списанием. Не задано — включена в production и
    // выключена в разработке: иначе dev-сервер ставил бы неявки демо-данным.
    ATTENDANCE_JOB: z.enum(['on', 'off']).optional(),
    ATTENDANCE_JOB_INTERVAL: z
      .string()
      .default('5m')
      .refine(isDuration, 'Ожидается длительность вида 30s, 5m, 1h'),
    // Бот уведомлений в мессенджере MAX. Токен — в настройках бота на
    // business.max.ru, ссылка — адрес бота вида https://max.ru/yenisey_bot: к
    // ней приписывается ?start=<токен привязки>. Без токена в production
    // уведомления недоступны, а в разработке вместо MAX работает поддельный
    // транспорт (notifications/max.transport.ts).
    MAX_BOT_TOKEN: optional(z.string().min(10)),
    MAX_BOT_LINK: optional(
      z.string().regex(/^https:\/\/max\.ru\/[A-Za-z0-9_]+$/, 'Адрес бота вида https://max.ru/yenisey_bot'),
    ),
    // Секрет вебхука: MAX присылает его в заголовке X-Max-Bot-Api-Secret.
    // Задан — бот получает события вебхуком на <WEB_ORIGIN>/api/max/webhook
    // (так MAX советует для production), не задан — опрашивает GET /updates.
    MAX_WEBHOOK_SECRET: optional(
      z.string().regex(/^[A-Za-z0-9_-]{16,256}$/, 'От 16 символов: латиница, цифры, _ и -'),
    ),
    // Отправщик очереди уведомлений и приём событий бота. Не задано — как у
    // автонеявки: включены в production, выключены в разработке.
    NOTIFICATIONS_JOB: optional(z.enum(['on', 'off'])),
    NOTIFICATIONS_JOB_INTERVAL: z
      .string()
      .default('10s')
      .refine(isDuration, 'Ожидается длительность вида 30s, 5m, 1h'),
    // Адрес сайта для ссылок в сообщениях. Не задан — первый из CORS_ORIGINS.
    WEB_ORIGIN: optional(z.string().url()),
    // Пояс утренней сводки платформы: у платформы нет зала, а сводка «за
    // вчера» должна знать, где кончились сутки.
    PLATFORM_TIMEZONE: z.string().default('Asia/Krasnoyarsk').refine(isTimeZone, 'Ожидается пояс IANA, например Asia/Krasnoyarsk'),
  })
  .refine((env) => env.JWT_ACCESS_SECRET !== env.JWT_REFRESH_SECRET, {
    // Совпадение секретов означает, что refresh-токен примут как access:
    // подпись сойдётся, и долгоживущий токен обойдёт короткий срок жизни.
    message: 'JWT_ACCESS_SECRET и JWT_REFRESH_SECRET должны различаться',
    path: ['JWT_REFRESH_SECRET'],
  })
  .refine((env) => !env.MAX_BOT_TOKEN || env.MAX_BOT_LINK, {
    // Без адреса бота не собрать ссылку привязки, и токен лежал бы без дела.
    message: 'Задан MAX_BOT_TOKEN, но не задан MAX_BOT_LINK',
    path: ['MAX_BOT_LINK'],
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

/** Работает ли джоба автонеявки при этом окружении. */
export function attendanceJobEnabled(env: Pick<Env, 'ATTENDANCE_JOB' | 'NODE_ENV'>): boolean {
  return (env.ATTENDANCE_JOB ?? (env.NODE_ENV === 'production' ? 'on' : 'off')) === 'on';
}

/** Работают ли отправщик уведомлений и приём событий бота при этом окружении. */
export function notificationsJobEnabled(env: Pick<Env, 'NOTIFICATIONS_JOB' | 'NODE_ENV'>): boolean {
  return (env.NOTIFICATIONS_JOB ?? (env.NODE_ENV === 'production' ? 'on' : 'off')) === 'on';
}

/** Адрес сайта для ссылок в сообщениях, без косой черты в конце. */
export function webOrigin(env: Pick<Env, 'WEB_ORIGIN' | 'CORS_ORIGINS'>): string {
  const origin = env.WEB_ORIGIN ?? parseCorsOrigins(env.CORS_ORIGINS)[0] ?? 'http://localhost:3000';

  return origin.replace(/\/+$/, '');
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function isDuration(value: string): boolean {
  try {
    return parseDuration(value) > 0;
  } catch {
    return false;
  }
}

/** Источники для CORS: в .env хранятся строкой через запятую. */
export function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
