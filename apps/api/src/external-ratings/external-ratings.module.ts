import { Module } from '@nestjs/common';
import { DevExternalRatingsController } from './dev-external-ratings.controller';
import { ExternalRatingClaimsController } from './external-rating-claims.controller';
import { ExternalRatingClaimsService } from './external-rating-claims.service';
import { ExternalRatingsJob } from './external-ratings.job';
import { ExternalRatingsService } from './external-ratings.service';

/**
 * Рейтинги игрока во внешних системах (решения владельца от 20.10.2026):
 * ежедневная сверка с ФНТР (и RTTW за выключателем). Показывает их профиль
 * игрока — `PlayersService.publicProfile` читает таблицу сам.
 */
@Module({
  controllers: [DevExternalRatingsController, ExternalRatingClaimsController],
  providers: [ExternalRatingsService, ExternalRatingsJob, ExternalRatingClaimsService],
})
export class ExternalRatingsModule {}
