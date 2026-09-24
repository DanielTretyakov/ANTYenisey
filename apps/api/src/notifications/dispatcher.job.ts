import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationStatus, Prisma } from '@yenisey/database';
import { parseDuration } from '../auth/tokens';
import { notificationsJobEnabled, webOrigin, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { stillRelevant } from './client-notifier.service';
import { MaxTransport } from './max.transport';
import { afterFailure } from './notification-rules';
import { combinePush, toPushPayload, type PushOutcome } from './push-rules';
import { PushTransport } from './push.transport';
import { renderNotification, type RenderedMessage } from './render';

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

/** Итог строки очереди — одинаковый у обоих каналов. */
type RowOutcome =
  | { kind: 'sent' }
  | { kind: 'skipped'; error: string }
  | { kind: 'retry'; error: string }
  | { kind: 'fatal'; error: string };

interface ClaimedRow {
  id: string;
  userId: string;
  channel: string;
  tenantId: string | null;
  type: string;
  payload: unknown;
  attempts: number;
  createdAt: Date;
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
  /** Когда уходило последнее сообщение в MAX — всего и каждому: лимиты бота. */
  private lastSend = 0;
  private readonly lastToUser = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly max: MaxTransport,
    private readonly push: PushTransport,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    const enabled = notificationsJobEnabled({
      NOTIFICATIONS_JOB: this.config.get('NOTIFICATIONS_JOB', { infer: true }),
      NODE_ENV: this.config.get('NODE_ENV', { infer: true }),
    });

    if (!enabled || (this.max.mode === 'off' && this.push.mode === 'off')) {
      this.logger.log(
        enabled
          ? 'Отправка уведомлений выключена: не настроены ни MAX, ни Web Push'
          : 'Отправка уведомлений выключена (NOTIFICATIONS_JOB)',
      );
      return;
    }

    this.logger.log(`Отправка уведомлений включена: MAX — ${this.max.mode}, Web Push — ${this.push.mode}`);
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

    const users = [...new Set(claimed.map((row) => row.userId))];
    const [links, subscriptions] = await Promise.all([
      this.prisma.maxLink.findMany({
        where: { userId: { in: users } },
        select: { userId: true, maxUserId: true, blockedAt: true },
      }),
      this.prisma.pushSubscription.findMany({
        where: { userId: { in: users } },
        select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true },
      }),
    ]);
    const linkOf = new Map(links.map((link) => [link.userId, link]));
    const devicesOf = new Map<string, typeof subscriptions>();

    for (const subscription of subscriptions) {
      devicesOf.set(subscription.userId, [...(devicesOf.get(subscription.userId) ?? []), subscription]);
    }

    const origin = webOrigin({
      WEB_ORIGIN: this.config.get('WEB_ORIGIN', { infer: true }),
      CORS_ORIGINS: this.config.get('CORS_ORIGINS', { infer: true }),
    });

    let sent = 0;

    for (const row of claimed) {
      // Напоминание об отменённой или перенесённой записи — хуже тишины.
      if (!(await stillRelevant(this.prisma, row))) {
        await this.finish(row.id, NotificationStatus.SKIPPED, 'устарело: запись отменена или перенесена');
        continue;
      }

      let message: RenderedMessage;

      try {
        message = renderNotification(row.type, row.payload, { webOrigin: origin });
      } catch (error) {
        await this.finish(row.id, NotificationStatus.FAILED, error instanceof Error ? error.message : String(error));
        continue;
      }

      const outcome =
        row.channel === 'WEB_PUSH'
          ? await this.sendPush(row, message, devicesOf.get(row.userId) ?? [], origin)
          : await this.sendMax(row, message, linkOf.get(row.userId));

      switch (outcome.kind) {
        case 'sent':
          await this.prisma.notification.update({
            where: { id: row.id },
            data: { status: NotificationStatus.SENT, sentAt: new Date(), lastError: null },
          });
          sent += 1;
          break;

        case 'skipped':
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

  /** В MAX — с паузами под лимиты бота. */
  private async sendMax(
    row: ClaimedRow,
    message: RenderedMessage,
    link: { maxUserId: bigint; blockedAt: Date | null } | undefined,
  ): Promise<RowOutcome> {
    // Привязку сняли или бота остановили, пока строка ждала очереди.
    if (!link || link.blockedAt) {
      return { kind: 'skipped', error: link ? 'бот остановлен' : 'нет привязки MAX' };
    }

    await pause(Math.max(this.lastSend + GLOBAL_GAP_MS, (this.lastToUser.get(row.userId) ?? 0) + PER_USER_GAP_MS) - Date.now());

    const outcome = await this.max.send({ maxUserId: link.maxUserId, ...message });
    this.lastSend = Date.now();
    this.lastToUser.set(row.userId, this.lastSend);

    if (outcome.kind === 'blocked') {
      // Человек остановил бота: всё, что ему ещё лежит в очереди, отпадёт тем
      // же путём, а привязка ждёт, пока он запустит бота снова.
      await this.prisma.maxLink.updateMany({
        where: { userId: row.userId, blockedAt: null },
        data: { blockedAt: new Date() },
      });

      return { kind: 'skipped', error: outcome.error };
    }

    return outcome;
  }

  /**
   * В браузер — на все устройства человека. Отозванные подписки (404, 410)
   * удаляются сразу: слать туда больше нечего.
   */
  private async sendPush(
    row: ClaimedRow,
    message: RenderedMessage,
    devices: readonly { id: string; endpoint: string; p256dh: string; auth: string }[],
    origin: string,
  ): Promise<RowOutcome> {
    if (devices.length === 0) {
      return { kind: 'skipped', error: 'нет подписок браузера' };
    }

    const payload = toPushPayload(message, { webOrigin: origin, tag: row.id });
    const outcomes: PushOutcome[] = [];

    for (const device of devices) {
      const outcome = await this.push.send(device, payload);
      outcomes.push(outcome);

      if (outcome.kind === 'gone') {
        await this.prisma.pushSubscription.deleteMany({ where: { id: device.id } });
      } else if (outcome.kind === 'sent') {
        await this.prisma.pushSubscription.updateMany({ where: { id: device.id }, data: { lastSentAt: new Date() } });
      }
    }

    return combinePush(outcomes);
  }

  /**
   * Аренда пачки: сдвинуть срок и засчитать попытку одним оператором.
   *
   * Порядок — по моменту создания, и сортируется он здесь, а не в запросе:
   * RETURNING отдаёт строки в порядке их обновления, а не подзапроса. Без
   * этого «запись отменена» могла уйти раньше «вы записаны» — так и случилось
   * в CI 24.09.2026, где план тренера обогнал запись в его группу.
   */
  private async claim(now: Date): Promise<ClaimedRow[]> {
    const lease = new Date(now.getTime() + LEASE_MS);

    const rows = await this.prisma.$queryRaw<ClaimedRow[]>(Prisma.sql`
      UPDATE "Notification"
      SET "sendAfter" = ${lease}, "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id" FROM "Notification"
        WHERE "status" = 'PENDING' AND "sendAfter" <= ${now}
        ORDER BY "sendAfter", "createdAt"
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "userId", "channel"::text AS "channel", "tenantId", "type"::text AS "type", "payload", "attempts", "createdAt"
    `);

    return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
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
