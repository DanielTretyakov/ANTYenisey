import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { GuardianshipModule } from '../guardianship/guardianship.module';
import { PlayerAccess } from './player-access.service';
import {
  MePlayerController,
  PlayerFilesController,
  PlayersController,
  RankReviewController,
} from './players.controller';
import { PlayersService } from './players.service';
import { RankReviewService } from './rank-review.service';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Профиль игрока: аватар, инвентарь, достижения, разряд и его проверка
 * клубом. Расширение сверх ТЗ по решению владельца от 12.09.2026.
 *
 * `PlayersService` отдаётся наружу ради карточки человека: администратор
 * смотрит профиль игрока и решает по разряду оттуда.
 */
@Module({
  imports: [FilesModule, GuardianshipModule, NotificationsModule],
  controllers: [MePlayerController, PlayersController, PlayerFilesController, RankReviewController],
  providers: [PlayersService, PlayerAccess, RankReviewService],
  exports: [PlayersService],
})
export class PlayersModule {}
