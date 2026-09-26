import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import type {
  AttendanceHistoryItem,
  AttendanceKind,
  AttendanceResult,
  DeskVisit,
} from '@yenisey/types';
import { AttendanceService } from './attendance.service';
import { MarkAttendanceBatchDto, MarkAttendanceDto, RecordVisitDto } from './dto/attendance.dto';
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { ClubContext } from '../auth/club-context';

/** Вид записи участком адреса — строчными, как принято в адресах. */
const KIND_BY_SEGMENT: Record<string, AttendanceKind> = {
  table: 'TABLE',
  training: 'TRAINING',
  tournament: 'TOURNAMENT',
};

/**
 * Отметка присутствия — часть рабочего места администратора.
 *
 * Роли на классе, как у `DeskController`: отмечают только администратор и
 * владелец (ТЗ), тренер — нет. Маршрут, добавленный сюда завтра, окажется
 * закрытым по умолчанию, а за каждым здесь стоят деньги.
 *
 * Автор отметки — из клубного контекста, а не из тела: иначе неявку можно было
 * бы подписать чужим именем, и журнал аудита перестал бы что-либо доказывать.
 */
@Roles('ADMIN', 'MANAGER', 'OWNER')
@Controller('clubs/:slug/desk')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  /**
   * Отметка одной записи.
   *
   * PUT, потому что это установка состояния, а не действие: повтор того же
   * запроса ничего не меняет и в журнал не пишет.
   */
  @Put('attendance/:kind/:entryId')
  mark(
    @CurrentClub() club: ClubContext,
    @Param('kind') kind: string,
    @Param('entryId') entryId: string,
    @Body() dto: MarkAttendanceDto,
    @Ip() ip: string,
  ): Promise<AttendanceResult> {
    return this.attendance.mark(club.tenantId, kindOf(kind), entryId, dto, {
      userId: club.userId,
      ipAddress: ip ?? null,
    });
  }

  /** «Отметить всех пришедшими» — всё или ничего. */
  @Post('attendance')
  @HttpCode(200)
  markMany(
    @CurrentClub() club: ClubContext,
    @Body() dto: MarkAttendanceBatchDto,
    @Ip() ip: string,
  ): Promise<AttendanceResult[]> {
    return this.attendance.markMany(club.tenantId, dto.marks, {
      userId: club.userId,
      ipAddress: ip ?? null,
    });
  }

  /** История отметок записи — для спора с клиентом. */
  @Get('attendance/:kind/:entryId/history')
  history(
    @CurrentClub() club: ClubContext,
    @Param('kind') kind: string,
    @Param('entryId') entryId: string,
  ): Promise<AttendanceHistoryItem[]> {
    return this.attendance.history(club.tenantId, kindOf(kind), entryId);
  }

  /** Визит с порога или внесённый задним числом. */
  @Post('visits')
  recordVisit(
    @CurrentClub() club: ClubContext,
    @Body() dto: RecordVisitDto,
    @Ip() ip: string,
  ): Promise<DeskVisit> {
    return this.attendance.recordVisit(club.tenantId, dto, {
      userId: club.userId,
      ipAddress: ip ?? null,
    });
  }
}

function kindOf(segment: string): AttendanceKind {
  const kind = KIND_BY_SEGMENT[segment];

  if (!kind) {
    throw new NotFoundException('Нет такого вида записи');
  }

  return kind;
}
