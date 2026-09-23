/**
 * Разбор того, что приходит от MAX: события бота, команды и ответы Bot API.
 *
 * Чистый модуль без относительных импортов — гоняется `node --test`. Формат
 * событий сверен с официальным клиентом @maxhub/max-bot-api (типы Update):
 * у события есть `update_type`, у человека — `user.user_id`.
 */

/** Событие бота, сведённое к тому, что нам от него нужно. */
export type BotEvent =
  /** Человек открыл бота — по ссылке привязки (`payload`) или сам. */
  | { kind: 'started'; maxUserId: bigint; payload: string | null }
  /** Остановил бота или удалил диалог: слать больше некуда. */
  | { kind: 'stopped'; maxUserId: bigint }
  /** Написал боту в личный диалог. */
  | { kind: 'message'; maxUserId: bigint; text: string };

/**
 * Событие MAX → BotEvent. Всё, что не про личный диалог с ботом, — null:
 * в группы бота никто не добавляет, а отвечать там было бы некому.
 */
export function parseUpdate(raw: unknown): BotEvent | null {
  if (!isObject(raw)) {
    return null;
  }

  switch (raw.update_type) {
    case 'bot_started': {
      const maxUserId = userIdOf(raw.user);
      const payload = typeof raw.payload === 'string' && raw.payload ? raw.payload : null;

      return maxUserId === null ? null : { kind: 'started', maxUserId, payload };
    }

    case 'bot_stopped':
    case 'dialog_removed': {
      const maxUserId = userIdOf(raw.user);

      return maxUserId === null ? null : { kind: 'stopped', maxUserId };
    }

    case 'message_created': {
      const message = raw.message;

      if (!isObject(message) || !isObject(message.recipient) || message.recipient.chat_type !== 'dialog') {
        return null;
      }

      const maxUserId = userIdOf(message.sender);
      const text = isObject(message.body) && typeof message.body.text === 'string' ? message.body.text : '';

      return maxUserId === null ? null : { kind: 'message', maxUserId, text };
    }

    default:
      return null;
  }
}

export type BotCommand = { name: 'stop' } | { name: 'help' };

/**
 * Команда из текста сообщения. Всё, что не «стоп», — просьба о помощи:
 * промолчать человеку, написавшему боту «привет», значит оставить его гадать,
 * работает ли бот вообще.
 */
export function parseCommand(text: string): BotCommand {
  const head = text.trim().split(/\s+/)[0]?.toLowerCase() ?? '';

  return head === '/stop' || head === 'стоп' ? { name: 'stop' } : { name: 'help' };
}

/**
 * Похоже ли на токен привязки. Параметр `start` MAX пропускает не длиннее 128
 * символов и без символов, требующих кодирования, — наш токен 32 символа из
 * [A-Za-z0-9_-]. Всё прочее не наш токен, и идти с ним в базу незачем.
 */
export function isLinkToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

/** Чем кончилась попытка отправить сообщение. */
export type SendOutcome =
  | { kind: 'sent' }
  | { kind: 'blocked'; error: string }
  | { kind: 'retry'; error: string }
  | { kind: 'fatal'; error: string };

/** Ошибка Bot API в том виде, в каком она приходит. */
export interface BotApiError {
  code?: string;
  message?: string;
}

/**
 * Что значит ответ Bot API для строки очереди.
 *
 * 403 и 404 — человек остановил бота или диалога больше нет: повтор ничего не
 * изменит. 429 — лимит; 5xx и обрыв сети (статус 0) — сбой на их стороне. 401
 * — неверный токен: это наша настройка, а не сообщение, и строку стоит
 * попробовать ещё раз, когда токен поправят. Прочие 4xx — ошибка в нашем
 * запросе, повтор даст то же.
 */
export function classifyReply(status: number, error: BotApiError | null): SendOutcome {
  if (status >= 200 && status < 300) {
    return { kind: 'sent' };
  }

  const text = `${status}: ${error?.code ?? 'error'} ${error?.message ?? 'нет ответа'}`.slice(0, 1000);

  if (status === 403 || status === 404) {
    return { kind: 'blocked', error: text };
  }

  if (status === 0 || status === 401 || status === 429 || status >= 500) {
    return { kind: 'retry', error: text };
  }

  return { kind: 'fatal', error: text };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Идентификатор человека в MAX. Приходит числом JSON: целое за пределами
 * 2^53 потеряло бы точность ещё при разборе, и такой идентификатор отвергается,
 * а не записывается чужим.
 */
function userIdOf(user: unknown): bigint | null {
  if (!isObject(user) || typeof user.user_id !== 'number' || !Number.isSafeInteger(user.user_id)) {
    return null;
  }

  return BigInt(user.user_id);
}
