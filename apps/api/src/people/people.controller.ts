import { Controller, Get, Param } from '@nestjs/common';
import type { ClubPersonCard } from '@yenisey/types';
import { PeopleService } from './people.service';
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { ClubContext } from '../auth/club-context';

/**
 * Карточка человека в клубе.
 *
 * Отдельный контроллер, а не метод `ClubController`: тот про устройство клуба
 * — залы, цены, справочники, — а это операционка, которую открывают из смены
 * и из состава клуба по десять раз за вечер.
 *
 * Роли на классе: в карточке телефон, почта, дата рождения и вся история
 * человека. Маршрут, добавленный сюда завтра, окажется закрытым по умолчанию.
 */
@Roles('ADMIN', 'OWNER')
@Controller('clubs/:slug/people')
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  /** Человек целиком: кто он в клубе, сводка, записи и визиты — одним запросом. */
  @Get(':id')
  card(@CurrentClub() club: ClubContext, @Param('id') userId: string): Promise<ClubPersonCard> {
    return this.people.card(club.tenantId, userId);
  }
}
