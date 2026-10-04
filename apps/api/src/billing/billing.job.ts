import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseDuration } from '../auth/tokens';
import { billingJobEnabled, type Env } from '../config/env';
import { BillingService } from './billing.service';

/** Первый проход — не сразу при старте: пусть API сначала поднимется. */
const FIRST_RUN_DELAY = 30_000;

/**
 * Джоба подписки клуба на КНТ: напоминания, автосписания, просрочка,
 * приостановка. Включается только явным BILLING_JOB=on — даже в
 * production: приостановка отменяет все будущие записи клуба, и включать
 * такое надо осознанно.
 */
@Injectable()
export class BillingJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BillingJob.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly billing: BillingService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (!billingJobEnabled({ BILLING_JOB: this.config.get('BILLING_JOB', { infer: true }) })) {
      return;
    }

    this.schedule(FIRST_RUN_DELAY);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delay: number): void {
    if (this.stopped) return;

    this.timer = setTimeout(() => {
      void this.billing
        .runOnce()
        .then(({ steps }) => {
          const done = Object.entries(steps).filter(([kind]) => kind !== 'none');
          if (done.length > 0) this.logger.log(`Подписки клубов: ${done.map(([kind, count]) => `${kind} ${count}`).join(', ')}`);
        })
        .catch((error: unknown) => this.logger.error('Проход подписок клубов не удался', error as Error))
        .finally(() => this.schedule(parseDuration(this.config.get('BILLING_JOB_INTERVAL', { infer: true }))));
    }, delay);
    this.timer.unref();
  }
}
