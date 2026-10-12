import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { DevMailController } from './dev-mail.controller';
import { MailDispatcher } from './mail-dispatcher.job';
import { MailService } from './mail.service';
import { DisabledMailTransport, FakeMailTransport, LiveSmtpTransport, MailTransport } from './mail.transport';

/**
 * Почта платформы (решения владельца от 12.10.2026).
 *
 * Транспорт выбирается как у MAX: задан `SMTP_URL` — настоящий; нет — в
 * production выключен, вне его поддельный с открытыми `/api/dev/mail/*`.
 * Поддельный в production невозможен намеренно: у него открытые маршруты.
 *
 * Модуль глобальный: письма ставят auth, заявки клубов, заведение клуба,
 * подписка и новости — каждый в своей транзакции, одной строкой.
 */
@Global()
@Module({
  controllers: [DevMailController],
  providers: [
    {
      provide: MailTransport,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): MailTransport => {
        const url = config.get('SMTP_URL', { infer: true });

        if (url) {
          return new LiveSmtpTransport(url);
        }

        return config.get('NODE_ENV', { infer: true }) === 'production' ? new DisabledMailTransport() : new FakeMailTransport();
      },
    },
    MailService,
    MailDispatcher,
  ],
  exports: [MailService],
})
export class MailModule {}
