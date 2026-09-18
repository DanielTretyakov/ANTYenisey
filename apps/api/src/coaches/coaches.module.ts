import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { CoachAdminController, CoachesController, MeCoachController } from './coaches.controller';
import { CoachesService } from './coaches.service';

/**
 * Карточка тренера: фотография, достижения, инвентарь, стоимость, соцсети, и
 * состав своих групп.
 *
 * `CoachesService` отдаётся наружу ради карточки человека: администратор
 * смотрит и правит карточку тренера оттуда.
 */
@Module({
  imports: [FilesModule],
  controllers: [MeCoachController, CoachAdminController, CoachesController],
  providers: [CoachesService],
  exports: [CoachesService],
})
export class CoachesModule {}
