import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseDuration } from '../auth/tokens';
import { externalRatingsJobEnabled, type Env } from '../config/env';
import { ExternalRatingsService } from './external-ratings.service';

/** Первый проход — через пять минут после старта: выкладка не должна начинаться с 170 запросов наружу. */
const FIRST_RUN_DELAY = 5 * 60_000;

/**
 * Сверка внешних рейтингов раз в сутки (EXTERNAL_RATINGS_JOB_INTERVAL). Чаще
 * незачем: ФНТР считается раз в месяц, RTTW — раз в неделю.
 */
@Injectable()
export class ExternalRatingsJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ExternalRatingsJob.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly ratings: ExternalRatingsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    const enabled = externalRatingsJobEnabled({
      EXTERNAL_RATINGS_JOB: this.config.get('EXTERNAL_RATINGS_JOB', { infer: true }),
      NODE_ENV: this.config.get('NODE_ENV', { infer: true }),
    });

    if (enabled) this.schedule(FIRST_RUN_DELAY);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delay: number): void {
    if (this.stopped) return;

    this.timer = setTimeout(() => {
      void this.ratings
        .runOnce()
        .catch((error: unknown) => this.logger.error('Сверка внешних рейтингов не удалась', error as Error))
        .finally(() => this.schedule(parseDuration(this.config.get('EXTERNAL_RATINGS_JOB_INTERVAL', { infer: true }))));
    }, delay);
    this.timer.unref();
  }
}
