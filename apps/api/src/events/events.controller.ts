import { BadRequestException, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import type { BookingEntry, ClubEvent, EventDetail } from '@yenisey/types';
import type { ClubContext } from '../auth/club-context';
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Acting, ClientAction, type ActingClient } from '../guardianship/acting-client.guard';
import { EventsRangeDto } from './events-range.dto';
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
   * `userId` — отдельной ветки здесь не нужно. С `?for=` отметка «записан»
   * считается для ребёнка вошедшего родителя.
   */
  @Public()
  @ClientAction('read')
  @Get('events')
  upcoming(
    @CurrentClub() club: ClubContext,
    @Acting() acting: ActingClient | null,
    @Query() range: EventsRangeDto,
  ): Promise<ClubEvent[]> {
    return this.events.listUpcoming(club.tenantId, acting?.userId ?? null, range);
  }

  /**
   * Окно мероприятия: описание, зал, тренер и записавшиеся кружками.
   *
   * Вид — участком адреса (`training` или `tournament`): занятие и турнир
   * лежат в разных таблицах, и по идентификатору вид не восстановить. Маршрут
   * объявлен после `events/mine` не случайно — у того один участок, у этого
   * два, и перепутать их Nest не может.
   */
  @Public()
  @ClientAction('read')
  @Get('events/:kind/:id')
  detail(
    @CurrentClub() club: ClubContext,
    @Acting() acting: ActingClient | null,
    @Param('kind') kind: string,
    @Param('id') id: string,
  ): Promise<EventDetail> {
    if (kind !== 'training' && kind !== 'tournament') {
      throw new BadRequestException('Вид мероприятия — training или tournament');
    }

    return this.events.detail(
      club.tenantId,
      kind === 'training' ? 'TRAINING' : 'TOURNAMENT',
      id,
      acting?.userId ?? null,
    );
  }

  /**
   * Мои мероприятия в этом клубе: записи на турниры и свои брони столов.
   *
   * Роль не проверяется: записаться может любой пользователь платформы, и
   * `@Roles('CLIENT')` закрыл бы этот список тренеру, который забронировал
   * стол под спарринг.
   */
  @ClientAction('read')
  @Get('events/mine')
  mine(@CurrentClub() club: ClubContext, @Acting() acting: ActingClient): Promise<BookingEntry[]> {
    return this.events.listMine(club.tenantId, acting.userId);
  }

  /**
   * Запись на турнир.
   *
   * `@ClientAction()` здесь означает «клиент этого клуба — тот, за кого
   * запись»: человек без привязки проходит как клиент, и запись заводит
   * привязку сама; родитель записывает ребёнка младше 14 параметром `?for=`.
   */
  @ClientAction()
  @Post('tournaments/:id/registration')
  register(
    @CurrentClub() club: ClubContext,
    @Acting() acting: ActingClient,
    @Param('id') id: string,
  ): Promise<BookingEntry> {
    return this.events.register(club.tenantId, acting.userId, id);
  }

  /** Отмена возвращает саму запись: человек должен увидеть, сколько с него списалось. */
  @ClientAction()
  @Delete('tournaments/:id/registration')
  cancel(
    @CurrentClub() club: ClubContext,
    @Acting() acting: ActingClient,
    @Param('id') id: string,
  ): Promise<BookingEntry> {
    return this.events.cancel(club.tenantId, acting.userId, id);
  }

  /**
   * Запись на занятие.
   *
   * Отдельный маршрут, а не общий с турниром по идентификатору мероприятия:
   * записи лежат в разных таблицах, и «мероприятие вообще» — понятие
   * интерфейса, а не базы. Идентификатор в адресе — сессии.
   */
  @ClientAction()
  @Post('trainings/:id/booking')
  registerForTraining(
    @CurrentClub() club: ClubContext,
    @Acting() acting: ActingClient,
    @Param('id') id: string,
  ): Promise<BookingEntry> {
    return this.events.registerForTraining(club.tenantId, acting.userId, id);
  }

  @ClientAction()
  @Delete('trainings/:id/booking')
  cancelTraining(
    @CurrentClub() club: ClubContext,
    @Acting() acting: ActingClient,
    @Param('id') id: string,
  ): Promise<BookingEntry> {
    return this.events.cancelTraining(club.tenantId, acting.userId, id);
  }
}
