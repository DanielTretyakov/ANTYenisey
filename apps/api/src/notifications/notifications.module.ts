import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { DevMaxController } from './dev-max.controller';
import { NotificationDispatcher } from './dispatcher.job';
import { MaxBotService } from './max-bot.service';
import { MaxLinkService } from './max-link.service';
import { MaxUpdatesJob } from './max-updates.job';
import { MaxWebhookController } from './max-webhook.controller';
import { DisabledMaxTransport, FakeMaxTransport, LiveMaxTransport, MaxTransport } from './max.transport';
import { MeNotificationsController } from './me-notifications.controller';
import { NotificationsService } from './notifications.service';

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
 * `NotificationsService` экспортируется: ставить уведомления в очередь будут
 * модули записи, отметки, разряда и абонементов — в своих транзакциях.
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
    MaxUpdatesJob,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
