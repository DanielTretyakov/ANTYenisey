import { Module } from '@nestjs/common';
import { DeskController } from './desk.controller';
import { DeskService } from './desk.service';
import { AttendanceModule } from '../attendance/attendance.module';
import { BookingModule } from '../booking/booking.module';
import { ClubModule } from '../club/club.module';
import { NotificationsModule } from '../notifications/notifications.module';

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
 *
 * `AttendanceModule` — ради отметок: экран смены показывает, кто и когда
 * отметил, а бронь задним числом сразу становится «пришёл».
 */
@Module({
  imports: [AttendanceModule, BookingModule, ClubModule, NotificationsModule],
  controllers: [DeskController],
  providers: [DeskService],
})
export class DeskModule {}
