import { Body, Controller, HttpCode, HttpStatus, Ip, Post, UseGuards } from '@nestjs/common';
import type { BookingEntry } from '@yenisey/types';
import type { ClubContext } from '../auth/club-context';
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { DeskShiftGuard } from '../staff/desk-shift.guard';
import { ClubEnrollDto, ClubEntryCancelDto } from './club-entries.dto';
import { EventsService } from './events.service';

/**
 * Клуб записывает человека на занятие или турнир и отменяет его запись —
 * по звонку (решения владельца от 10.10.2026).
 *
 * Тем же правилом, что смена: администратор — в день своей смены,
 * управляющий — в своих залах, руководитель — всегда (`DeskShiftGuard`).
 * Иначе «кто-то другой случайно внесёт», а за записью стоят чужие деньги.
 * Автор берётся из клубного контекста, а не из тела запроса.
 */
@Roles('ADMIN', 'MANAGER', 'OWNER')
@UseGuards(DeskShiftGuard)
@Controller('clubs/:slug/desk')
export class ClubEntriesController {
  constructor(private readonly events: EventsService) {}

  @Post('event-entries')
  enroll(@CurrentClub() club: ClubContext, @Body() dto: ClubEnrollDto, @Ip() ip: string): Promise<BookingEntry> {
    return this.events.enrollByClub(club.tenantId, { userId: club.userId, ipAddress: ip ?? null }, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('event-entries/cancel')
  cancel(@CurrentClub() club: ClubContext, @Body() dto: ClubEntryCancelDto, @Ip() ip: string): Promise<BookingEntry> {
    return this.events.cancelByClub(club.tenantId, { userId: club.userId, ipAddress: ip ?? null }, {
      kind: dto.kind,
      entryId: dto.entryId,
      waiveCharge: dto.waiveCharge ?? false,
    });
  }
}
