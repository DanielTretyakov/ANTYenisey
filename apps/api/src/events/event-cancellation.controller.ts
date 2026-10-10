import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { EventCancelResult } from '@yenisey/types';
import type { ClubContext } from '../auth/club-context';
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { EventCancelDto } from './event-cancel.dto';
import { EventCancellationService } from './event-cancellation.service';

/**
 * Отмена занятия или турнира клубом (решение владельца от 10.10.2026) —
 * персоналом: администратор, управляющий, руководитель. Тренер звонит
 * администратору.
 *
 * Отдельным контроллером в модуле мероприятий, а не в `ClubController`:
 * отмене нужны абонементы и сообщения клиентам, а модулю клуба — нет.
 * Не-GET: у приостановленного клуба закрыта `ClubContextGuard` — его будущие
 * записи и так отменены приостановкой.
 */
@Roles('ADMIN', 'MANAGER', 'OWNER')
@Controller('clubs/:slug')
export class EventCancellationController {
  constructor(private readonly cancellation: EventCancellationService) {}

  @HttpCode(HttpStatus.OK)
  @Post('training-sessions/:id/cancel')
  cancelTraining(
    @CurrentClub() club: ClubContext,
    @Param('id') id: string,
    @Body() dto: EventCancelDto,
  ): Promise<EventCancelResult> {
    return this.cancellation.cancel(club.tenantId, club.userId, 'TRAINING', id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('tournaments/:id/cancel')
  cancelTournament(
    @CurrentClub() club: ClubContext,
    @Param('id') id: string,
    @Body() dto: EventCancelDto,
  ): Promise<EventCancelResult> {
    return this.cancellation.cancel(club.tenantId, club.userId, 'TOURNAMENT', id, dto);
  }
}
