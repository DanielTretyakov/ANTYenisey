import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import type {
  BookingDay,
  BookingQuote,
  ClientBooking,
  Hall,
  PublicDayBoard,
} from '@yenisey/types';
import { BookingService } from './booking.service';
import { CreateBookingDto, QuoteQueryDto } from './dto/booking.dto';
import { ClubService } from '../club/club.service';
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { Acting, ClientAction, type ActingClient } from '../guardianship/acting-client.guard';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { ClubContext } from '../auth/club-context';

/**
 * Самостоятельная онлайн-бронь стола.
 *
 * Клуб берётся из адреса и сверяется с привязкой человека к клубу в
 * ClubContextGuard. Подставить в адрес чужой клуб можно — и именно поэтому
 * роль читается из базы на каждый запрос, а не из токена.
 *
 * Сами брони закрыты клиентским действием (`@ClientAction`): роль `CLIENT`
 * проверяется у того, ЗА КОГО бронь, — родитель бронирует за ребёнка младше 14
 * параметром `?for=`, а сам ребёнок до 14 не бронирует. Это не формальность: бронь ссылается на
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
   * Открыто всем, даже без входа: прайс — то, что клуб и так показывает на
   * стене (и в карточке клуба), а сетку дня с 24.09.2026 смотрят до
   * регистрации. Бронь по-прежнему только вошедшему.
   */
  @Public()
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

  /**
   * Открытая сетка дня: свободное время и чем занято остальное — аренда без
   * имён, занятие с тренером, турнир, «стол занят». Без входа: новичок из
   * поиска должен увидеть, есть ли смысл регистрироваться.
   */
  @Public()
  @Get('halls/:hallId/days/:date/board')
  findBoard(
    @CurrentClub() club: ClubContext,
    @Param('hallId') hallId: string,
    @Param('date') date: string,
  ): Promise<PublicDayBoard> {
    return this.booking.findBoard(club.tenantId, hallId, date);
  }

  /** Стоимость аренды до подтверждения: сумму клиент должен видеть заранее. Открыта, как и прайс. */
  @Public()
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

  @ClientAction()
  @Post('bookings')
  create(
    @CurrentClub() club: ClubContext,
    @Acting() acting: ActingClient,
    @Body() dto: CreateBookingDto,
  ): Promise<ClientBooking> {
    return this.booking.create(club.tenantId, { kind: 'client', userId: acting.userId }, dto);
  }

  @ClientAction('read')
  @Get('bookings')
  listMine(@CurrentClub() club: ClubContext, @Acting() acting: ActingClient): Promise<ClientBooking[]> {
    return this.booking.listMine(club.tenantId, { kind: 'client', userId: acting.userId });
  }

  /**
   * Отмена брони.
   *
   * Возвращает саму бронь, а не пустой ответ: клиент должен увидеть, сколько
   * с него списалось по политике клуба, и получать это вторым запросом
   * незачем.
   */
  @ClientAction()
  @Delete('bookings/:id')
  cancel(
    @CurrentClub() club: ClubContext,
    @Acting() acting: ActingClient,
    @Param('id') bookingId: string,
  ): Promise<ClientBooking> {
    return this.booking.cancel(club.tenantId, { kind: 'client', userId: acting.userId }, bookingId);
  }
}

/**
 * Спарринг: стол, который тренер берёт под занятие с учеником.
 *
 * Третий сценарий ТЗ — «стандартная аренда стола, инициированная тренером тем
 * же механизмом бронирования, что и у клиента, с пометкой „спарринг“». Тем же
 * механизмом буквально: те же залы, та же сетка, тот же расчёт цены и те же
 * правила отмены — отличается только владелец строки.
 *
 * Ученик в такой брони не записан вовсе: заполнено либо `clientId`, либо
 * `coachId`, и это держит CHECK. Кто именно играет с тренером — вопрос к
 * тренеру, а не к платформе; попытка записать сюда ещё и клиента означала бы
 * вторую бронь на тот же стол.
 *
 * Адрес — в клубном пространстве тренера (`/coach/...`), рядом с его карточкой
 * и группами; логика при этом остаётся в модуле брони, где ей и место.
 */
@Roles('COACH')
@Controller('clubs/:slug/coach/sparring')
export class SparringController {
  constructor(private readonly booking: BookingService) {}

  @Post()
  create(@CurrentClub() club: ClubContext, @Body() dto: CreateBookingDto): Promise<ClientBooking> {
    return this.booking.create(club.tenantId, { kind: 'coach', userId: club.userId }, dto);
  }

  @Get()
  listMine(@CurrentClub() club: ClubContext): Promise<ClientBooking[]> {
    return this.booking.listMine(club.tenantId, { kind: 'coach', userId: club.userId });
  }

  @Delete(':id')
  cancel(@CurrentClub() club: ClubContext, @Param('id') bookingId: string): Promise<ClientBooking> {
    return this.booking.cancel(club.tenantId, { kind: 'coach', userId: club.userId }, bookingId);
  }
}
