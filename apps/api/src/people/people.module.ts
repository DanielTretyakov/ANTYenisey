import { Module } from '@nestjs/common';
import { PeopleController } from './people.controller';
import { PeopleService } from './people.service';
import { AttendanceModule } from '../attendance/attendance.module';
import { EntriesModule } from '../entries/entries.module';

/**
 * Карточка человека в клубе.
 *
 * `EntriesModule` — ради `EntriesService`: список записей человека собирает
 * он же, что и «Мои записи». Второй сборщик разошёлся бы с первым сначала в
 * мелочах, потом в деньгах.
 *
 * `AttendanceModule` — ради подписей «кто отметил» и визитов с порога.
 */
@Module({
  imports: [AttendanceModule, EntriesModule],
  controllers: [PeopleController],
  providers: [PeopleService],
})
export class PeopleModule {}
