import { Module } from '@nestjs/common';
import { MeRatingController, RatingController } from './rating.controller';
import { RatingService } from './rating.service';

/**
 * Рейтинг посещений клуба (решение владельца от 26.09.2026). `RatingService`
 * отдаётся наружу ради «Больше всего посещений» в профиле игрока.
 */
@Module({
  controllers: [RatingController, MeRatingController],
  providers: [RatingService],
  exports: [RatingService],
})
export class RatingModule {}
