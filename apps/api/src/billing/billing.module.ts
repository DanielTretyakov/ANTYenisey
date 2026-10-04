import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ClubBillingController, PlatformClubsController, PlatformPlansController, YooKassaWebhookController } from './billing.controller';
import { BillingJob } from './billing.job';
import { BillingService } from './billing.service';
import { DevBillingController } from './dev-billing.controller';
import { DisabledPaymentProvider, FakePaymentProvider, PaymentProvider, YooKassaPaymentProvider } from './payment-provider';

/**
 * Подписка клуба на КНТ. Шлюз выбирается так же, как транспорт MAX и
 * справочник адресов: ключи ЮKassa — настоящий; без них вне production —
 * поддельный с маршрутами `/api/dev/payments`; в production без ключей
 * оплата картой выключена (по счёту работает).
 */
@Module({
  imports: [NotificationsModule, SubscriptionsModule],
  controllers: [ClubBillingController, PlatformClubsController, PlatformPlansController, YooKassaWebhookController, DevBillingController],
  providers: [
    BillingService,
    BillingJob,
    {
      provide: PaymentProvider,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): PaymentProvider => {
        const shopId = config.get('YOOKASSA_SHOP_ID', { infer: true });
        const secret = config.get('YOOKASSA_SECRET_KEY', { infer: true });

        if (shopId && secret) return new YooKassaPaymentProvider(shopId, secret);

        return config.get('NODE_ENV', { infer: true }) === 'production' ? new DisabledPaymentProvider() : new FakePaymentProvider();
      },
    },
  ],
  exports: [BillingService],
})
export class BillingModule {}
