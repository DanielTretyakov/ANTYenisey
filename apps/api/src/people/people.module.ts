import { Module } from '@nestjs/common';
import { PeopleController } from './people.controller';
import { PeopleService } from './people.service';
import { AttendanceModule } from '../attendance/attendance.module';
import { ClubModule } from '../club/club.module';
import { CoachesModule } from '../coaches/coaches.module';
import { EntriesModule } from '../entries/entries.module';
import { PlayersModule } from '../players/players.module';
import { GuardianshipModule } from '../guardianship/guardianship.module';

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
 *
 * `PlayersModule` — ради профиля игрока в карточке: разряд проверяет
 * администратор, и смотрит он отсюда.
 *
 * `CoachesModule` — ради карточки тренера: её правит администратор оттуда же.
 */
@Module({
  imports: [AttendanceModule, ClubModule, CoachesModule, EntriesModule, PlayersModule, GuardianshipModule],
  controllers: [PeopleController],
  providers: [PeopleService],
})
export class PeopleModule {}
