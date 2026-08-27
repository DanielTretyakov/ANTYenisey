import { Module } from '@nestjs/common';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { ClubModule } from '../club/club.module';

/**
 * Движок бронирования. `ClubModule` импортируется ради `ClubService`: список
 * залов с ценами клиенту нужен тот же самый, что видит администратор в
 * настройках, и второй его вариант неизбежно разошёлся бы с первым.
 */
@Module({
  imports: [ClubModule],
  controllers: [BookingController],
  providers: [BookingService],
  exports: [BookingService],
})
export class BookingModule {}
