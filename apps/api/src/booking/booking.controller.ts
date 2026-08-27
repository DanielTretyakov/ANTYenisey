import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import type {
  AccessTokenPayload,
  BookingDay,
  BookingQuote,
  ClientBooking,
  Hall,
} from '@yenisey/types';
import { BookingService } from './booking.service';
import { CreateBookingDto, QuoteQueryDto } from './dto/booking.dto';
import { ClubService } from '../club/club.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

/**
 * Самостоятельная онлайн-бронь стола.
 *
 * Клуб берётся из access-токена, а не из адреса: подставить туда чужой
 * идентификатор клиенту неоткуда, и обратиться к соседнему клубу он физически
 * не может.
 *
 * Сами брони закрыты ролью `CLIENT`. Это не формальность: бронь ссылается на
 * `ClientProfile`, которого у администратора и тренера просто нет, и без
 * проверки запрос упал бы ошибкой внешнего ключа вместо внятного ответа.
 * Ручная бронь администратором и спарринг тренером — отдельные сценарии ТЗ со
 * своими правилами, и подпирать ими этот маршрут нельзя.
 */
@Controller('booking')
export class BookingController {
  constructor(
    private readonly booking: BookingService,
    private readonly club: ClubService,
  ) {}

  /**
   * Залы клуба с ценами и шагом брони.
   *
   * Открыто любой вошедшей роли, а не только клиенту: прайс — то, что клуб и
   * так показывает на стене, и прятать его от собственного тренера незачем.
   */
  @Get('halls')
  listHalls(@CurrentUser() user: AccessTokenPayload): Promise<Hall[]> {
    return this.club.listHalls(user.tenantId);
  }

  /** Что свободно в зале на дату. Причина занятости клиенту не раскрывается. */
  @Get('halls/:hallId/days/:date')
  findDay(
    @CurrentUser() user: AccessTokenPayload,
    @Param('hallId') hallId: string,
    @Param('date') date: string,
  ): Promise<BookingDay> {
    return this.booking.findDay(user.tenantId, hallId, date);
  }

  /** Стоимость аренды до подтверждения: сумму клиент должен видеть заранее. */
  @Get('quote')
  quote(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: QuoteQueryDto,
  ): Promise<BookingQuote> {
    return this.booking.quote(
      user.tenantId,
      query.hallId,
      query.durationMinutes,
      query.withRobot,
    );
  }

  @Roles('CLIENT')
  @Post('bookings')
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateBookingDto,
  ): Promise<ClientBooking> {
    return this.booking.create(user.tenantId, user.sub, dto);
  }

  @Roles('CLIENT')
  @Get('bookings')
  listMine(@CurrentUser() user: AccessTokenPayload): Promise<ClientBooking[]> {
    return this.booking.listMine(user.tenantId, user.sub);
  }

  /**
   * Отмена брони.
   *
   * Возвращает саму бронь, а не пустой ответ: клиент должен увидеть, сколько
   * с него списалось по политике клуба, и получать это вторым запросом
   * незачем.
   */
  @Roles('CLIENT')
  @Delete('bookings/:id')
  cancel(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') bookingId: string,
  ): Promise<ClientBooking> {
    return this.booking.cancel(user.tenantId, user.sub, bookingId);
  }
}
