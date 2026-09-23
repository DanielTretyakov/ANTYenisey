import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { notificationsJobEnabled, webOrigin, type Env } from '../config/env';
import { MaxBotService } from './max-bot.service';
import { MaxTransport } from './max.transport';

/** Пауза после сбоя опроса: от 5 секунд, вдвое на каждый сбой, не больше минуты. */
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;

/**
 * Откуда бот берёт события MAX.
 *
 * На стенде — вебхук: MAX прямо советует его для production, а long polling
 * там ограничен по частоте. При старте API подписывается на
 * <WEB_ORIGIN>/api/max/webhook с секретом MAX_WEBHOOK_SECRET — сам маршрут в
 * max-webhook.controller.ts. В разработке публичного https-адреса нет, и бот
 * опрашивает GET /updates.
 *
 * Работает только с настоящим ботом: у поддельного событий нет, их приносит
 * отладочный маршрут смоука.
 */
@Injectable()
export class MaxUpdatesJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MaxUpdatesJob.name);
  private readonly abort = new AbortController();
  private loop: Promise<void> | null = null;

  constructor(
    private readonly transport: MaxTransport,
    private readonly bot: MaxBotService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    const enabled = notificationsJobEnabled({
      NOTIFICATIONS_JOB: this.config.get('NOTIFICATIONS_JOB', { infer: true }),
      NODE_ENV: this.config.get('NODE_ENV', { infer: true }),
    });

    if (!enabled || this.transport.mode !== 'live') {
      return;
    }

    const secret = this.config.get('MAX_WEBHOOK_SECRET', { infer: true });

    if (secret) {
      const origin = webOrigin({
        WEB_ORIGIN: this.config.get('WEB_ORIGIN', { infer: true }),
        CORS_ORIGINS: this.config.get('CORS_ORIGINS', { infer: true }),
      });

      // Подписка — не повод не стартовать: упала — события не придут, но
      // рассылка работает, и в журнале видно, что чинить.
      this.transport
        .subscribe(`${origin}/api/max/webhook`, secret)
        .catch((error: unknown) =>
          this.logger.error('Не удалось подписать вебхук MAX', error instanceof Error ? error.message : error),
        );
      return;
    }

    this.logger.log('События MAX: опрос GET /updates');
    this.loop = this.poll();
  }

  async onModuleDestroy(): Promise<void> {
    this.abort.abort();
    await this.loop;
  }

  private async poll(): Promise<void> {
    let marker: number | null = null;
    let delay = RETRY_BASE_MS;

    while (!this.abort.signal.aborted) {
      try {
        const page = await this.transport.getUpdates(marker, this.abort.signal);
        marker = page.marker;
        delay = RETRY_BASE_MS;

        for (const update of page.updates) {
          // Одно сломанное событие не должно останавливать остальные.
          await this.bot.handle(update).catch((error: unknown) => {
            this.logger.error('Событие MAX не обработано', error instanceof Error ? error.stack : error);
          });
        }
      } catch (error) {
        if (this.abort.signal.aborted) {
          return;
        }

        this.logger.warn(`Опрос MAX не удался, повтор через ${delay / 1000} с: ${error instanceof Error ? error.message : error}`);
        await new Promise((resolve) => setTimeout(resolve, delay).unref());
        delay = Math.min(delay * 2, RETRY_MAX_MS);
      }
    }
  }
}
