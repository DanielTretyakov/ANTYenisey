import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import type { BookingEntry, ClubEvent } from '@yenisey/types';
import type { ClubContext } from '../auth/club-context';
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { EventsService } from './events.service';

/**
 * Мероприятия клуба глазами человека, а не администратора.
 *
 * Отдельный контроллер, а не маршруты в ClubController: на том висит классовый
 * `@Roles('ADMIN', 'OWNER')`, и клиентские маршруты пришлось бы протаскивать
 * сквозь него исключениями — ровно тот способ, которым права однажды и
 * протекают.
 */
@Controller('clubs/:slug')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /**
   * Предстоящие мероприятия клуба. Открыто без входа: клуб выбирают до того,
   * как заводят учётку.
   *
   * ClubContextGuard анонима пропускает и сам кладёт контекст клуба с пустым
   * `userId` — отдельной ветки здесь не нужно.
   */
  @Public()
  @Get('events')
  upcoming(@CurrentClub() club: ClubContext): Promise<ClubEvent[]> {
    return this.events.listUpcoming(club.tenantId, club.userId || null);
  }

  /**
   * Мои мероприятия в этом клубе: записи на турниры и свои брони столов.
   *
   * Роль не проверяется: записаться может любой пользователь платформы, и
   * `@Roles('CLIENT')` закрыл бы этот список тренеру, который забронировал
   * стол под спарринг.
   */
  @Get('events/mine')
  mine(@CurrentClub() club: ClubContext): Promise<BookingEntry[]> {
    return this.events.listMine(club.tenantId, club.userId);
  }

  /**
   * Запись на турнир.
   *
   * `@Roles('CLIENT')` здесь означает «не сотрудник этого клуба»: человек без
   * привязки проходит как клиент, и запись заводит привязку сама.
   */
  @Roles('CLIENT')
  @Post('tournaments/:id/registration')
  register(@CurrentClub() club: ClubContext, @Param('id') id: string): Promise<BookingEntry> {
    return this.events.register(club.tenantId, club.userId, id);
  }

  /** Отмена возвращает саму запись: человек должен увидеть, сколько с него списалось. */
  @Roles('CLIENT')
  @Delete('tournaments/:id/registration')
  cancel(@CurrentClub() club: ClubContext, @Param('id') id: string): Promise<BookingEntry> {
    return this.events.cancel(club.tenantId, club.userId, id);
  }

  /**
   * Запись на занятие.
   *
   * Отдельный маршрут, а не общий с турниром по идентификатору мероприятия:
   * записи лежат в разных таблицах, и «мероприятие вообще» — понятие
   * интерфейса, а не базы. Идентификатор в адресе — сессии.
   */
  @Roles('CLIENT')
  @Post('trainings/:id/booking')
  registerForTraining(
    @CurrentClub() club: ClubContext,
    @Param('id') id: string,
  ): Promise<BookingEntry> {
    return this.events.registerForTraining(club.tenantId, club.userId, id);
  }

  @Roles('CLIENT')
  @Delete('trainings/:id/booking')
  cancelTraining(
    @CurrentClub() club: ClubContext,
    @Param('id') id: string,
  ): Promise<BookingEntry> {
    return this.events.cancelTraining(club.tenantId, club.userId, id);
  }
}
