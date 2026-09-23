import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationStatus, Prisma } from '@yenisey/database';
import { parseDuration } from '../auth/tokens';
import { notificationsJobEnabled, webOrigin, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { MaxTransport } from './max.transport';
import { afterFailure } from './notification-rules';
import { renderNotification } from './render';

/** Сколько строк берётся за проход. */
const BATCH = 25;

/**
 * На сколько строка «арендуется» отправщиком. Упал процесс посреди отправки —
 * через две минуты строку подберёт следующий проход, и попытка засчитается.
 */
const LEASE_MS = 2 * 60_000;

/**
 * Паузы под лимиты MAX: 30 запросов в секунду на бота и 2 сообщения в секунду
 * в один диалог. Берём с запасом: 25 в секунду и одно в 600 мс.
 */
const GLOBAL_GAP_MS = 40;
const PER_USER_GAP_MS = 600;

const FIRST_RUN_DELAY = 5_000;

interface ClaimedRow {
  id: string;
  userId: string;
  type: string;
  payload: unknown;
  attempts: number;
}

/**
 * Отправщик очереди уведомлений.
 *
 * Строки забираются не транзакцией на всё время отправки, а арендой: один
 * UPDATE … FOR UPDATE SKIP LOCKED сдвигает им `sendAfter` на две минуты вперёд
 * и считает попытку. Держать транзакцию открытой, пока идёт запрос в MAX,
 * значило бы занимать соединение пула на время чужой сети; а несколько
 * экземпляров API благодаря SKIP LOCKED не возьмут одну строку дважды.
 *
 * Устроен как AutoNoShowJob: цепочка setTimeout, проходы не накладываются.
 */
@Injectable()
export class NotificationDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NotificationDispatcher.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transport: MaxTransport,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    const enabled = notificationsJobEnabled({
      NOTIFICATIONS_JOB: this.config.get('NOTIFICATIONS_JOB', { infer: true }),
      NODE_ENV: this.config.get('NODE_ENV', { infer: true }),
    });

    if (!enabled || this.transport.mode === 'off') {
      this.logger.log(
        this.transport.mode === 'off'
          ? 'Отправка уведомлений выключена: MAX не настроен'
          : 'Отправка уведомлений выключена (NOTIFICATIONS_JOB)',
      );
      return;
    }

    this.logger.log(`Отправка уведомлений включена, транспорт ${this.transport.mode}`);
    this.schedule(FIRST_RUN_DELAY);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;

    if (this.timer) {
      clearTimeout(this.timer);
    }

    await this.running;
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      let full = false;

      this.running = this.runOnce()
        .then((result) => {
          full = result.claimed === BATCH;
        })
        .catch((error: unknown) => {
          this.logger.error('Проход отправки упал', error instanceof Error ? error.stack : error);
        })
        .finally(() => {
          this.running = null;

          if (!this.stopped) {
            // Полная пачка — очередь не пуста, следующую берём сразу.
            this.schedule(full ? 0 : parseDuration(this.config.get('NOTIFICATIONS_JOB_INTERVAL', { infer: true })));
          }
        });
    }, delay);

    this.timer.unref();
  }

  /**
   * Один проход: забрать пачку и разослать.
   *
   * Открыт ради проверок: смоук зовёт его через отладочный маршрут, а не ждёт
   * интервала.
   */
  async runOnce(now = new Date()): Promise<{ claimed: number; sent: number }> {
    const claimed = await this.claim(now);

    if (claimed.length === 0) {
      return { claimed: 0, sent: 0 };
    }

    const links = await this.prisma.maxLink.findMany({
      where: { userId: { in: [...new Set(claimed.map((row) => row.userId))] } },
      select: { userId: true, maxUserId: true, blockedAt: true },
    });
    const linkOf = new Map(links.map((link) => [link.userId, link]));
    const origin = webOrigin({
      WEB_ORIGIN: this.config.get('WEB_ORIGIN', { infer: true }),
      CORS_ORIGINS: this.config.get('CORS_ORIGINS', { infer: true }),
    });

    const lastToUser = new Map<string, number>();
    let lastSend = 0;
    let sent = 0;

    for (const row of claimed) {
      const link = linkOf.get(row.userId);

      // Привязку сняли или бота остановили, пока строка ждала очереди.
      if (!link || link.blockedAt) {
        await this.finish(row.id, NotificationStatus.SKIPPED, link ? 'бот остановлен' : 'нет привязки MAX');
        continue;
      }

      let message;

      try {
        message = renderNotification(row.type, row.payload, { webOrigin: origin });
      } catch (error) {
        await this.finish(row.id, NotificationStatus.FAILED, error instanceof Error ? error.message : String(error));
        continue;
      }

      await pause(Math.max(lastSend + GLOBAL_GAP_MS, (lastToUser.get(row.userId) ?? 0) + PER_USER_GAP_MS) - Date.now());

      const outcome = await this.transport.send({ maxUserId: link.maxUserId, ...message });
      lastSend = Date.now();
      lastToUser.set(row.userId, lastSend);

      switch (outcome.kind) {
        case 'sent':
          await this.prisma.notification.update({
            where: { id: row.id },
            data: { status: NotificationStatus.SENT, sentAt: new Date(), lastError: null },
          });
          sent += 1;
          break;

        case 'blocked':
          // Человек остановил бота: всё, что ему ещё лежит в очереди, отпадёт
          // тем же путём, а привязка ждёт, пока он запустит бота снова.
          await this.prisma.maxLink.updateMany({
            where: { userId: row.userId, blockedAt: null },
            data: { blockedAt: new Date() },
          });
          await this.finish(row.id, NotificationStatus.SKIPPED, outcome.error);
          break;

        case 'retry': {
          const next = afterFailure(row.attempts, new Date());
          await this.prisma.notification.update({
            where: { id: row.id },
            data: next.status === 'FAILED'
              ? { status: NotificationStatus.FAILED, lastError: outcome.error }
              : { status: NotificationStatus.PENDING, sendAfter: next.sendAfter, lastError: outcome.error },
          });
          break;
        }

        case 'fatal':
          await this.finish(row.id, NotificationStatus.FAILED, outcome.error);
          break;
      }
    }

    return { claimed: claimed.length, sent };
  }

  /** Аренда пачки: сдвинуть срок и засчитать попытку одним оператором. */
  private claim(now: Date): Promise<ClaimedRow[]> {
    const lease = new Date(now.getTime() + LEASE_MS);

    return this.prisma.$queryRaw<ClaimedRow[]>(Prisma.sql`
      UPDATE "Notification"
      SET "sendAfter" = ${lease}, "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id" FROM "Notification"
        WHERE "status" = 'PENDING' AND "channel" = 'MAX' AND "sendAfter" <= ${now}
        ORDER BY "sendAfter"
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "userId", "type"::text AS "type", "payload", "attempts"
    `);
  }

  private async finish(id: string, status: NotificationStatus, error: string): Promise<void> {
    await this.prisma.notification.update({
      where: { id },
      data: { status, lastError: error.slice(0, 1000) },
    });
  }
}

function pause(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
