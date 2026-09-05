import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import type {
  BookingDay,
  BookingQuote,
  ClientBooking,
  Hall,
} from '@yenisey/types';
import { BookingService } from './booking.service';
import { CreateBookingDto, QuoteQueryDto } from './dto/booking.dto';
import { ClubService } from '../club/club.service';
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { ClubContext } from '../auth/club-context';

/**
 * Самостоятельная онлайн-бронь стола.
 *
 * Клуб берётся из адреса и сверяется с привязкой человека к клубу в
 * ClubContextGuard. Подставить в адрес чужой клуб можно — и именно поэтому
 * роль читается из базы на каждый запрос, а не из токена.
 *
 * Сами брони закрыты ролью `CLIENT`. Это не формальность: бронь ссылается на
 * `ClientProfile`, которого у администратора и тренера просто нет, и без
 * проверки запрос упал бы ошибкой внешнего ключа вместо внятного ответа.
 * Ручная бронь администратором и спарринг тренером — отдельные сценарии ТЗ со
 * своими правилами, и подпирать ими этот маршрут нельзя.
 *
 * Записаться может ЛЮБОЙ пользователь платформы, вступать в клуб для
 * этого не требуется (ТЗ → «Один аккаунт на все клубы»): человек без
 * привязки проходит сюда как клиент, а сама привязка заводится первой бронью.
 */
@Controller('clubs/:slug/booking')
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
  listHalls(@CurrentClub() club: ClubContext): Promise<Hall[]> {
    return this.club.listHalls(club.tenantId);
  }

  /** Что свободно в зале на дату. Причина занятости клиенту не раскрывается. */
  @Get('halls/:hallId/days/:date')
  findDay(
    @CurrentClub() club: ClubContext,
    @Param('hallId') hallId: string,
    @Param('date') date: string,
  ): Promise<BookingDay> {
    return this.booking.findDay(club.tenantId, hallId, date);
  }

  /** Стоимость аренды до подтверждения: сумму клиент должен видеть заранее. */
  @Get('quote')
  quote(
    @CurrentClub() club: ClubContext,
    @Query() query: QuoteQueryDto,
  ): Promise<BookingQuote> {
    return this.booking.quote(
      club.tenantId,
      query.hallId,
      query.durationMinutes,
      query.withRobot,
    );
  }

  @Roles('CLIENT')
  @Post('bookings')
  create(
    @CurrentClub() club: ClubContext,
    @Body() dto: CreateBookingDto,
  ): Promise<ClientBooking> {
    return this.booking.create(club.tenantId, club.userId, dto);
  }

  @Roles('CLIENT')
  @Get('bookings')
  listMine(@CurrentClub() club: ClubContext): Promise<ClientBooking[]> {
    return this.booking.listMine(club.tenantId, club.userId);
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
    @CurrentClub() club: ClubContext,
    @Param('id') bookingId: string,
  ): Promise<ClientBooking> {
    return this.booking.cancel(club.tenantId, club.userId, bookingId);
  }
}
