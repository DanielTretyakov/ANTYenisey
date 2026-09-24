import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { ClientNotifier } from './client-notifier.service';
import { DevMaxController } from './dev-max.controller';
import { DigestSchedule } from './digest-schedule';
import { NotificationDispatcher } from './dispatcher.job';
import { MaxBotService } from './max-bot.service';
import { MaxLinkService } from './max-link.service';
import { MaxUpdatesJob } from './max-updates.job';
import { MaxWebhookController } from './max-webhook.controller';
import { DisabledMaxTransport, FakeMaxTransport, LiveMaxTransport, MaxTransport } from './max.transport';
import { MeNotificationsController } from './me-notifications.controller';
import { NotificationsService } from './notifications.service';
import { DevPushController } from './dev-push.controller';
import { DisabledPushTransport, FakePushTransport, LivePushTransport, PushTransport } from './push.transport';
import { NotificationScheduler } from './scheduler.job';
import { StaffNotifier } from './staff-notifier.service';
import { StaffSchedule } from './staff-schedule';

/**
 * Уведомления: очередь, её отправщик, бот в мессенджере MAX и уведомления в
 * браузер (Web Push).
 *
 * Транспорт выбирается один раз при старте:
 *   есть MAX_BOT_TOKEN  → настоящий Bot API;
 *   нет, не production  → поддельный, для разработки и смоука;
 *   нет, production     → выключен: подключить MAX нельзя, и страница
 *                          настроек так и говорит.
 * Поддельный в production невозможен намеренно — у него открытые отладочные
 * маршруты. Web Push выбирается так же, по ключам VAPID.
 *
 * `ClientNotifier` и `StaffNotifier` экспортируются: сообщения клиенту и
 * персоналу ставят в очередь модули записи, отметки, разряда и семьи —
 * в своих транзакциях, одной строкой.
 * Сам модуль от них не зависит, поэтому циклов импорта нет.
 */
@Module({
  controllers: [MeNotificationsController, MaxWebhookController, DevMaxController, DevPushController],
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
    {
      provide: PushTransport,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): PushTransport => {
        const publicKey = config.get('VAPID_PUBLIC_KEY', { infer: true });
        const privateKey = config.get('VAPID_PRIVATE_KEY', { infer: true });
        const subject = config.get('VAPID_SUBJECT', { infer: true });

        if (publicKey && privateKey && subject) {
          return new LivePushTransport(publicKey, privateKey, subject);
        }

        return config.get('NODE_ENV', { infer: true }) === 'production'
          ? new DisabledPushTransport()
          : new FakePushTransport();
      },
    },
    NotificationsService,
    MaxLinkService,
    MaxBotService,
    NotificationDispatcher,
    NotificationScheduler,
    MaxUpdatesJob,
    ClientNotifier,
    StaffNotifier,
    StaffSchedule,
    DigestSchedule,
  ],
  exports: [NotificationsService, ClientNotifier, StaffNotifier],
})
export class NotificationsModule {}
