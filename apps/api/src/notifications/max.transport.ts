import { Logger } from '@nestjs/common';
import { classifyReply, type BotApiError, type SendOutcome } from './max-rules';
import { buttonAllowed } from './render';

/** Базовый адрес Bot API MAX — тот же, что у официального клиента. */
const API = 'https://platform-api2.max.ru';

/** События, которые бот слушает: привязка, остановка, сообщения в диалоге. */
export const UPDATE_TYPES = ['bot_started', 'bot_stopped', 'dialog_removed', 'message_created'] as const;

export interface OutgoingMessage {
  maxUserId: bigint;
  text: string;
  link?: { label: string; url: string };
}

export interface UpdatesPage {
  updates: unknown[];
  marker: number | null;
}

/**
 * Транспорт до MAX.
 *
 * Абстрактный класс, а не интерфейс: он же служит токеном внедрения. Живой
 * транспорт ходит в Bot API, поддельный — копит сообщения в памяти для
 * разработки и смоука, выключенный — честно говорит, что бота нет.
 */
export abstract class MaxTransport {
  /** live — настоящий бот; fake — разработка без бота; off — production без токена. */
  abstract readonly mode: 'live' | 'fake' | 'off';

  abstract send(message: OutgoingMessage): Promise<SendOutcome>;

  /** Long polling: события после `marker`. Только в разработке. */
  abstract getUpdates(marker: number | null, signal: AbortSignal): Promise<UpdatesPage>;

  /** Подписка на вебхук: MAX будет присылать события на `url` с секретом. */
  abstract subscribe(url: string, secret: string): Promise<void>;
}

/**
 * Настоящий Bot API. Без библиотеки: нужны три метода, а официальный клиент
 * тянет за собой сессии, сценарии и повторы, которые у нас живут в очереди.
 */
export class LiveMaxTransport extends MaxTransport {
  readonly mode = 'live' as const;
  private readonly logger = new Logger('MaxTransport');

  constructor(private readonly token: string) {
    super();
  }

  async send(message: OutgoingMessage): Promise<SendOutcome> {
    const url = new URL('/messages', API);
    url.searchParams.set('user_id', message.maxUserId.toString());
    url.searchParams.set('disable_link_preview', 'true');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: this.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(messageBody(message)),
        signal: AbortSignal.timeout(15_000),
      });

      return classifyReply(response.status, response.ok ? null : await readError(response));
    } catch (error) {
      // Обрыв сети или таймаут: сообщение, скорее всего, не ушло — повторим.
      return classifyReply(0, { code: 'network', message: error instanceof Error ? error.message : String(error) });
    }
  }

  async getUpdates(marker: number | null, signal: AbortSignal): Promise<UpdatesPage> {
    const url = new URL('/updates', API);
    url.searchParams.set('timeout', '25');
    url.searchParams.set('limit', '100');
    url.searchParams.set('types', UPDATE_TYPES.join(','));

    if (marker !== null) {
      url.searchParams.set('marker', String(marker));
    }

    const response = await fetch(url, {
      headers: { Authorization: this.token },
      signal: AbortSignal.any([signal, AbortSignal.timeout(40_000)]),
    });

    if (!response.ok) {
      const error = await readError(response);
      throw new Error(`GET /updates: ${response.status} ${error?.code ?? ''} ${error?.message ?? ''}`);
    }

    const page = (await response.json()) as { updates?: unknown[]; marker?: number | null };

    return { updates: page.updates ?? [], marker: page.marker ?? marker };
  }

  async subscribe(url: string, secret: string): Promise<void> {
    const response = await fetch(new URL('/subscriptions', API), {
      method: 'POST',
      headers: { Authorization: this.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, update_types: UPDATE_TYPES, secret }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const error = await readError(response);
      throw new Error(`POST /subscriptions: ${response.status} ${error?.code ?? ''} ${error?.message ?? ''}`);
    }

    this.logger.log(`Вебхук MAX подписан: ${url}`);
  }
}

/** Сообщение, ушедшее в поддельный транспорт. */
export interface FakeSentMessage {
  maxUserId: string;
  text: string;
  link: { label: string; url: string } | null;
  at: string;
}

/**
 * Поддельный MAX для разработки и смоука: сообщения копятся в памяти, а
 * «остановивший бота» человек отвечает 403, как настоящий.
 *
 * Только вне production: там без токена транспорт выключен, а не поддельный
 * (см. notifications.module.ts).
 */
export class FakeMaxTransport extends MaxTransport {
  readonly mode = 'fake' as const;
  readonly sent: FakeSentMessage[] = [];
  readonly stopped = new Set<string>();

  async send(message: OutgoingMessage): Promise<SendOutcome> {
    const id = message.maxUserId.toString();

    if (this.stopped.has(id)) {
      return classifyReply(403, { code: 'chat.denied', message: 'поддельный MAX: бот остановлен' });
    }

    this.sent.push({ maxUserId: id, text: message.text, link: message.link ?? null, at: new Date().toISOString() });

    // Память разработки не бесконечна: хранится последняя тысяча сообщений.
    if (this.sent.length > 1000) {
      this.sent.splice(0, this.sent.length - 1000);
    }

    return { kind: 'sent' };
  }

  async getUpdates(): Promise<UpdatesPage> {
    return { updates: [], marker: null };
  }

  async subscribe(): Promise<void> {}
}

/** Production без токена: бота нет, и подключать нечего. */
export class DisabledMaxTransport extends MaxTransport {
  readonly mode = 'off' as const;

  async send(): Promise<SendOutcome> {
    return { kind: 'retry', error: 'MAX не настроен: нет MAX_BOT_TOKEN' };
  }

  async getUpdates(): Promise<UpdatesPage> {
    return { updates: [], marker: null };
  }

  async subscribe(): Promise<void> {}
}

/**
 * Тело сообщения. Кнопка-ссылка — вложение inline_keyboard; адрес, который
 * кнопкой открыть нельзя (localhost из разработки), уходит в текст.
 */
function messageBody(message: OutgoingMessage): Record<string, unknown> {
  const { link } = message;

  if (!link) {
    return { text: message.text };
  }

  if (!buttonAllowed(link.url)) {
    return { text: `${message.text}\n\n${link.label}: ${link.url}` };
  }

  return {
    text: message.text,
    attachments: [
      {
        type: 'inline_keyboard',
        payload: { buttons: [[{ type: 'link', text: link.label, url: link.url }]] },
      },
    ],
  };
}

async function readError(response: Response): Promise<BotApiError | null> {
  try {
    return (await response.json()) as BotApiError;
  } catch {
    return null;
  }
}
