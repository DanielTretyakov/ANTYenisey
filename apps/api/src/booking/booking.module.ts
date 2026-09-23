import { Module } from '@nestjs/common';
import { BookingController, SparringController } from './booking.controller';
import { BookingService } from './booking.service';
import { OccupancyService } from './occupancy.service';
import { ClubModule } from '../club/club.module';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Движок бронирования. `ClubModule` импортируется ради `ClubService`: список
 * залов с ценами клиенту нужен тот же самый, что видит администратор в
 * настройках, и второй его вариант неизбежно разошёлся бы с первым.
 *
 * `OccupancyService` экспортируется наружу: рабочее место администратора
 * спрашивает то же расписание, что и движок брони, и второй разбор шаблона
 * недели разошёлся бы с этим молча.
 */
@Module({
  imports: [ClubModule, NotificationsModule],
  controllers: [BookingController, SparringController],
  providers: [BookingService, OccupancyService],
  exports: [BookingService, OccupancyService],
})
export class BookingModule {}
