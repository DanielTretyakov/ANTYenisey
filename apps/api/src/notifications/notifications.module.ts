import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { ClientNotifier } from './client-notifier.service';
import { DevMaxController } from './dev-max.controller';
import { NotificationDispatcher } from './dispatcher.job';
import { MaxBotService } from './max-bot.service';
import { MaxLinkService } from './max-link.service';
import { MaxUpdatesJob } from './max-updates.job';
import { MaxWebhookController } from './max-webhook.controller';
import { DisabledMaxTransport, FakeMaxTransport, LiveMaxTransport, MaxTransport } from './max.transport';
import { MeNotificationsController } from './me-notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationScheduler } from './scheduler.job';

/**
 * Уведомления: очередь, её отправщик и бот в мессенджере MAX.
 *
 * Транспорт выбирается один раз при старте:
 *   есть MAX_BOT_TOKEN  → настоящий Bot API;
 *   нет, не production  → поддельный, для разработки и смоука;
 *   нет, production     → выключен: подключить MAX нельзя, и страница
 *                          настроек так и говорит.
 * Поддельный в production невозможен намеренно — у него открытые отладочные
 * маршруты.
 *
 * `ClientNotifier` экспортируется: сообщения клиенту ставят в очередь модули
 * записи, отметки, разряда и семьи — в своих транзакциях, одной строкой.
 * Сам модуль от них не зависит, поэтому циклов импорта нет.
 */
@Module({
  controllers: [MeNotificationsController, MaxWebhookController, DevMaxController],
  providers: [
    {
      provide: MaxTransport,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): MaxTransport => {
        const token = config.get('MAX_BOT_TOKEN', { infer: true });

        if (token) {
          return new LiveMaxTransport(token);
        }

        return config.get('NODE_ENV', { infer: true }) === 'production'
          ? new DisabledMaxTransport()
          : new FakeMaxTransport();
      },
    },
    NotificationsService,
    MaxLinkService,
    MaxBotService,
    NotificationDispatcher,
    NotificationScheduler,
    MaxUpdatesJob,
    ClientNotifier,
  ],
  exports: [NotificationsService, ClientNotifier],
})
export class NotificationsModule {}
