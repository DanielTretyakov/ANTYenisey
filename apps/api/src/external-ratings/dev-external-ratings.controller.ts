import { Controller, HttpCode, NotFoundException, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../auth/decorators/public.decorator';
import type { Env } from '../config/env';
import { ExternalRatingsService, type ExternalRatingsReport } from './external-ratings.service';

/**
 * Проход сверки внешних рейтингов по кнопке — только вне production: ходит в
 * настоящие ФНТР и RTTW, и открытый маршрут на стенде стал бы способом
 * завалить их запросами от нашего имени.
 */
@Public()
@Controller('dev/external-ratings')
export class DevExternalRatingsController {
  constructor(
    private readonly ratings: ExternalRatingsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @HttpCode(200)
  @Post('run')
  run(): Promise<ExternalRatingsReport> {
    if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
      throw new NotFoundException();
    }

    return this.ratings.runOnce();
  }
}
