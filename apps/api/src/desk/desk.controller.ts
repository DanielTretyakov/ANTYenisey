import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { DeskBooking, DeskDay } from '@yenisey/types';
import { DeskService } from './desk.service';
import {
  CancelDeskBookingDto,
  CreateDeskBookingDto,
  DeskBookingsQueryDto,
  MoveDeskBookingDto,
} from './dto/desk.dto';
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { ClubContext } from '../auth/club-context';

/**
 * Рабочее место администратора клуба.
 *
 * Раздел закрыт ролями на уровне контроллера, а не отдельных методов — так же,
 * как `ClubController`: маршрут, добавленный сюда завтра, окажется закрытым по
 * умолчанию, а не открытым по забывчивости. Здесь это важнее обычного: за
 * следующими маршрутами раздела стоят чужие деньги и телефоны.
 *
 * Клуб приходит участком адреса, и `ClubContextGuard` читает роль из
 * `TenantMembership` на каждый запрос: администратор «Енисея», подставивший в
 * адрес чужой клуб, окажется там клиентом и получит 403 от строки ниже.
 */
@Roles('ADMIN', 'OWNER')
@Controller('clubs/:slug/desk')
export class DeskController {
  constructor(private readonly desk: DeskService) {}

  /**
   * День зала целиком: столы, брони, мероприятия, загрузка и деньги.
   *
   * Зал и дата — участками адреса, а не query: экран смены пересылают
   * ссылкой («посмотри, что в субботу»), и адрес должен её нести.
   */
  @Get('halls/:hallId/days/:date')
  findDay(
    @CurrentClub() club: ClubContext,
    @Param('hallId') hallId: string,
    @Param('date') date: string,
  ): Promise<DeskDay> {
    return this.desk.findDay(club.tenantId, hallId, date);
  }

  // --- Брони клуба -----------------------------------------------------------

  /** Поиск по истории броней: диапазон дат, зал, клиент, статус. */
  @Get('bookings')
  listBookings(
    @CurrentClub() club: ClubContext,
    @Query() query: DeskBookingsQueryDto,
  ): Promise<DeskBooking[]> {
    return this.desk.listBookings(club.tenantId, query);
  }

  /**
   * Посадить человека за стол.
   *
   * Автор берётся из клубного контекста, а не из тела запроса: иначе одну
   * бронь можно было бы записать на другого сотрудника, и подпись «кто
   * посадил» перестала бы что-либо значить.
   */
  @Post('bookings')
  createBooking(
    @CurrentClub() club: ClubContext,
    @Body() dto: CreateDeskBookingDto,
  ): Promise<DeskBooking> {
    return this.desk.createBooking(club.tenantId, club.userId, dto);
  }

  /** Перенос: другой стол, другое время, другая длительность. */
  @Patch('bookings/:id')
  moveBooking(
    @CurrentClub() club: ClubContext,
    @Param('id') id: string,
    @Body() dto: MoveDeskBookingDto,
  ): Promise<DeskBooking> {
    return this.desk.moveBooking(club.tenantId, id, dto);
  }

  /**
   * Отмена брони администратором.
   *
   * POST с телом, а не DELETE: у отмены есть параметры («простить списание»),
   * а тело DELETE-запроса режет половина прокси. Клиентская отмена остаётся
   * DELETE — она без параметров.
   */
  @Post('bookings/:id/cancel')
  cancelBooking(
    @CurrentClub() club: ClubContext,
    @Param('id') id: string,
    @Body() dto: CancelDeskBookingDto,
  ): Promise<DeskBooking> {
    return this.desk.cancelBooking(club.tenantId, id, dto);
  }
}
