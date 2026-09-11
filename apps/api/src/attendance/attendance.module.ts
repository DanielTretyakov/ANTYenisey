import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { ClubModule } from '../club/club.module';

/**
 * Отметка присутствия.
 *
 * `AttendanceService` экспортируется ради рабочего места: бронь, заведённая
 * администратором задним числом, отмечается «пришёл» в той же транзакции, что
 * создаётся, а экран смены показывает, кто и когда поставил отметку.
 *
 * `ClubModule` — ради `MembershipService`: пришедший с порога может не
 * состоять в клубе, и привязка заводится тем же кодом, что при записи.
 */
@Module({
  imports: [ClubModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
