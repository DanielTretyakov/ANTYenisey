import { Controller, Delete, Get, Param, Put } from '@nestjs/common';
import type { AccessTokenPayload, BookingEntry, FavouriteClub, FeedEvent } from '@yenisey/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { EntriesService } from '../entries/entries.service';
import { Acting, ClientAction, type ActingClient } from '../guardianship/acting-client.guard';
import { MeService } from './me.service';

/**
 * Маршруты уровня платформы: мои клубы, лента их мероприятий, мои записи.
 *
 * Клуба в адресе НЕТ, и это не упущение. Аккаунт один на платформу: человек
 * ходит в три клуба и хочет расписание своей недели одним списком, а не тремя
 * обходами клубных страниц (ТЗ → «Мои записи»). ClubContextGuard такие
 * маршруты пропускает сам — он проверяет наличие `:slug` в адресе.
 */
@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly entries: EntriesService,
  ) {}

  /** Клубы, которые человек отметил своими. Не больше трёх. */
  @Get('clubs')
  clubs(@CurrentUser() user: AccessTokenPayload): Promise<FavouriteClub[]> {
    return this.me.listClubs(user.sub);
  }

  /**
   * Отметить клуб своим.
   *
   * PUT, а не POST: отметка идемпотентна — нажать кнопку дважды означает то же
   * самое, что нажать один раз.
   */
  @Put('clubs/:slug')
  addClub(
    @CurrentUser() user: AccessTokenPayload,
    @Param('slug') slug: string,
  ): Promise<FavouriteClub[]> {
    return this.me.addClub(user.sub, slug);
  }

  @Delete('clubs/:slug')
  removeClub(
    @CurrentUser() user: AccessTokenPayload,
    @Param('slug') slug: string,
  ): Promise<FavouriteClub[]> {
    return this.me.removeClub(user.sub, slug);
  }

  /** Ближайшие мероприятия моих клубов — лента стартовой страницы. */
  @Get('feed')
  feed(@CurrentUser() user: AccessTokenPayload): Promise<FeedEvent[]> {
    return this.me.feed(user.sub);
  }

  /**
   * Все записи человека по всем клубам: и турниры, и аренда столов.
   *
   * Отмены здесь нет намеренно. Каждая строка несёт код своего клуба, и
   * интерфейс отменяет её уже существующим клубным маршрутом. Второй путь
   * отмены разошёлся бы с первым — сначала в мелочах, потом в деньгах.
   *
   * С `?for=` — записи ребёнка вошедшего родителя, тем же сборщиком.
   */
  @ClientAction('read')
  @Get('bookings')
  bookings(@Acting() acting: ActingClient): Promise<BookingEntry[]> {
    return this.entries.listForUser(acting.userId);
  }
}
