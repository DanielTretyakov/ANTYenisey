import { Module } from '@nestjs/common';
import { DeskController } from './desk.controller';
import { DeskService } from './desk.service';
import { BookingModule } from '../booking/booking.module';
import { ClubModule } from '../club/club.module';

/**
 * Рабочее место администратора.
 *
 * `BookingModule` импортируется ради `OccupancyService`: расписание зала
 * рабочее место разбирает тем же кодом, что и движок брони. Второй разбор
 * шаблона недели разошёлся бы с первым молча, а заметили бы это по чужой
 * броне под тренировкой.
 *
 * `ClubModule` — ради `MembershipService`: администратор сажает человека,
 * который может не состоять в клубе, и привязка заводится тем же кодом, что
 * при самостоятельной записи.
 */
@Module({
  imports: [BookingModule, ClubModule],
  controllers: [DeskController],
  providers: [DeskService],
})
export class DeskModule {}
