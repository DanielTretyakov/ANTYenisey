import { Body, Controller, Get, HttpCode, Ip, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { ClubPerson, ClubPersonCard, FamilyChild, PlatformPersonLookup } from '@yenisey/types';
import { PeopleService } from './people.service';
import { PersonLookupQueryDto } from './dto/lookup.dto';
import { AttachGuardianDto, RevokeGuardianshipDto } from './dto/family.dto';
import { AccountDto } from '../auth/dto/register.dto';
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

  /**
   * Найти человека на платформе по точной почте или телефону — приём «с порога».
   *
   * Ограничение частоты своё, жёстче общего: маршрут отвечает «такой человек
   * есть», и без него перебор адресов стал бы способом узнать, кто
   * зарегистрирован на платформе.
   *
   * Стоит ДО `:id`: иначе «lookup» уехал бы в него идентификатором.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('lookup')
  lookup(
    @CurrentClub() club: ClubContext,
    @Query() query: PersonLookupQueryDto,
  ): Promise<PlatformPersonLookup> {
    return this.people.lookup(club.tenantId, query);
  }

  /** Человек целиком: кто он в клубе, сводка, записи и визиты — одним запросом. */
  @Get(':id')
  card(@CurrentClub() club: ClubContext, @Param('id') userId: string): Promise<ClubPersonCard> {
    return this.people.card(club.tenantId, userId);
  }

  /** Привязать найденного человека к клубу. Повтор — то же состояние, не ошибка. */
  @Post(':id/attach')
  @HttpCode(200)
  attach(@CurrentClub() club: ClubContext, @Param('id') userId: string): Promise<ClubPerson> {
    return this.people.attach(club.tenantId, userId);
  }

  /**
   * Завести ребёнка родителю `:id` у стойки — когда родитель не хочет
   * разбираться с сайтом. Почту и пароль ребёнку задаёт родитель, который
   * стоит рядом; учётка закрепляется сразу и привязывается к клубу.
   */
  @Post(':id/children')
  createChild(
    @CurrentClub() club: ClubContext,
    @Param('id') guardianId: string,
    @Body() dto: AccountDto,
    @Ip() ip: string,
  ): Promise<FamilyChild> {
    return this.people.createChild(club, guardianId, dto, ip ?? null);
  }

  /** Предложить закрепить ребёнка `:id` за родителем из клуба. Подтверждает ребёнок. */
  @Post(':id/guardian')
  @HttpCode(204)
  requestGuardian(
    @CurrentClub() club: ClubContext,
    @Param('id') childId: string,
    @Body() dto: AttachGuardianDto,
  ): Promise<void> {
    return this.people.requestGuardian(club, childId, dto.guardianId);
  }

  /** Снять закрепление ребёнка `:id` — с причиной, в журнал аудита клуба. */
  @Post(':id/guardian/revoke')
  @HttpCode(204)
  revokeGuardian(
    @CurrentClub() club: ClubContext,
    @Param('id') childId: string,
    @Body() dto: RevokeGuardianshipDto,
    @Ip() ip: string,
  ): Promise<void> {
    return this.people.revokeGuardian(club, childId, dto.reason, ip ?? null);
  }
}
