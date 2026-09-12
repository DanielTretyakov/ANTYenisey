import { Module } from '@nestjs/common';
import { PeopleController } from './people.controller';
import { PeopleService } from './people.service';
import { AttendanceModule } from '../attendance/attendance.module';
import { ClubModule } from '../club/club.module';
import { EntriesModule } from '../entries/entries.module';

/**
 * Карточка человека в клубе.
 *
 * `EntriesModule` — ради `EntriesService`: список записей человека собирает
 * он же, что и «Мои записи». Второй сборщик разошёлся бы с первым сначала в
 * мелочах, потом в деньгах.
 *
 * `AttendanceModule` — ради подписей «кто отметил» и визитов с порога.
 *
 * `ClubModule` — ради `MembershipService`: пришедшего с порога привязывает к
 * клубу тот же код, что и первая запись.
 */
@Module({
  imports: [AttendanceModule, ClubModule, EntriesModule],
  controllers: [PeopleController],
  providers: [PeopleService],
})
export class PeopleModule {}
