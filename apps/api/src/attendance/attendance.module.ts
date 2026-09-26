import { Module } from '@nestjs/common';
import { StaffModule } from '../staff/staff.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AutoNoShowJob } from './auto-no-show.job';
import { ClubModule } from '../club/club.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Отметка присутствия.
 *
 * `AttendanceService` экспортируется ради рабочего места: бронь, заведённая
 * администратором задним числом, отмечается «пришёл» в той же транзакции, что
 * создаётся, а экран смены показывает, кто и когда поставил отметку.
 *
 * `ClubModule` — ради `MembershipService`: пришедший с порога может не
 * состоять в клубе, и привязка заводится тем же кодом, что при записи.
 *
 * `AutoNoShowJob` живёт здесь же: неявку от джобы пишут те же функции, что и
 * неявку от администратора, — второй путь записи разошёлся бы с первым.
 *
 * `SubscriptionsModule` — ради визитов абонемента: прощённая неявка
 * возвращает визит в той же транзакции, что меняет отметку.
 */
@Module({
  imports: [ClubModule, SubscriptionsModule, NotificationsModule, StaffModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, AutoNoShowJob],
  exports: [AttendanceService],
})
export class AttendanceModule {}
