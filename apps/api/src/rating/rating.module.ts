import { Module } from '@nestjs/common';
import { MeRatingController, RatingController } from './rating.controller';
import { RatingService } from './rating.service';

/** Рейтинг посещений клуба (решение владельца от 26.09.2026). */
@Module({
  controllers: [RatingController, MeRatingController],
  providers: [RatingService],
})
export class RatingModule {}
