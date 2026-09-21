import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import {
  CoachAdminController,
  CoachesController,
  MeCoachCardController,
  MeCoachController,
} from './coaches.controller';
import { CoachesService } from './coaches.service';

/**
 * Тренер: карточка (одна на человека, без клуба в адресе), цены в каждом
 * клубе, состав групп и статистика.
 *
 * `CoachesService` отдаётся наружу ради карточки человека: администратор
 * видит там карточку тренера и его цены в этом клубе — только смотрит.
 */
@Module({
  imports: [FilesModule],
  controllers: [MeCoachCardController, MeCoachController, CoachAdminController, CoachesController],
  providers: [CoachesService],
  exports: [CoachesService],
})
export class CoachesModule {}
