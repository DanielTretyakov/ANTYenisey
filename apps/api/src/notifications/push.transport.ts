import * as webpush from 'web-push';
import { classifyPush, type PushOutcome, type PushPayload } from './push-rules';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Сколько служба push держит сообщение для выключенного устройства. */
const TTL_SECONDS = 24 * 3600;

/**
 * Транспорт уведомлений в браузер. Как MaxTransport: абстрактный класс служит
 * и токеном внедрения, а режимов три — настоящий, поддельный и выключенный.
 */
export abstract class PushTransport {
  abstract readonly mode: 'live' | 'fake' | 'off';
  /** Открытый ключ VAPID — браузер подписывается им. Пусто, если выключено. */
  abstract readonly publicKey: string | null;

  abstract send(target: PushTarget, payload: PushPayload): Promise<PushOutcome>;
}

/** Настоящие службы push браузеров через библиотеку web-push. */
export class LivePushTransport extends PushTransport {
  readonly mode = 'live' as const;

  constructor(
    readonly publicKey: string,
    private readonly privateKey: string,
    private readonly subject: string,
  ) {
    super();
  }

  async send(target: PushTarget, payload: PushPayload): Promise<PushOutcome> {
    try {
      const result = await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        {
          vapidDetails: { subject: this.subject, publicKey: this.publicKey, privateKey: this.privateKey },
          TTL: TTL_SECONDS,
          timeout: 15_000,
        },
      );

      return classifyPush(result.statusCode);
    } catch (error) {
      if (error instanceof webpush.WebPushError) {
        return classifyPush(error.statusCode, error.body);
      }

      // Обрыв сети, таймаут, неразборчивая подписка: сообщение, скорее всего,
      // не ушло — повторим.
      return classifyPush(0, error instanceof Error ? error.message : String(error));
    }
  }
}

/** Что ушло в поддельный транспорт. */
export interface FakePushMessage extends PushPayload {
  endpoint: string;
  at: string;
}

/**
 * Поддельные службы push для разработки и смоука: сообщения копятся в
 * памяти, а подписка из `gone` отвечает 410, как отозванная.
 *
 * Пара VAPID заводится на время запуска — настоящая, чтобы браузер на
 * машине разработчика мог подписаться, хотя сообщения до него и не дойдут.
 */
export class FakePushTransport extends PushTransport {
  readonly mode = 'fake' as const;
  readonly publicKey = webpush.generateVAPIDKeys().publicKey;
  readonly sent: FakePushMessage[] = [];
  readonly gone = new Set<string>();

  async send(target: PushTarget, payload: PushPayload): Promise<PushOutcome> {
    if (this.gone.has(target.endpoint)) {
      return classifyPush(410, 'поддельная служба push: подписка отозвана');
    }

    this.sent.push({ ...payload, endpoint: target.endpoint, at: new Date().toISOString() });

    if (this.sent.length > 1000) {
      this.sent.splice(0, this.sent.length - 1000);
    }

    return { kind: 'sent' };
  }
}

/** Production без ключей VAPID: уведомлений в браузер нет. */
export class DisabledPushTransport extends PushTransport {
  readonly mode = 'off' as const;
  readonly publicKey = null;

  async send(): Promise<PushOutcome> {
    return { kind: 'retry', error: 'Web Push не настроен: нет ключей VAPID' };
  }
}
