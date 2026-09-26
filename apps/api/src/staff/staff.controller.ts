import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { DeskAccess, StaffCandidate, StaffDayRequest, StaffHall, StaffSchedule } from '@yenisey/types';
import type { ClubContext } from '../auth/club-context';
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { StaffService } from './staff.service';

export class StaffDayDto implements StaffDayRequest {
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  adminIds: string[] = [];
}

export class StaffScheduleQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from — дата в виде 2026-09-27' })
  from?: string;
}

export class DeskAccessQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Type(() => String)
  hallId?: string;
}

/**
 * «Расписание персонала» (решение владельца от 26.09.2026): управляющий
 * назначает администраторов на дни своего зала, руководитель — любого.
 * Раздел — только руководству.
 */
@Roles('MANAGER', 'OWNER')
@Controller('clubs/:slug/staff-schedule')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get('halls')
  halls(@CurrentClub() club: ClubContext): Promise<StaffHall[]> {
    return this.staff.halls(club);
  }

  /** Кого можно поставить управляющим зала — людей с этой ролью. */
  @Roles('OWNER')
  @Get('managers')
  managers(@CurrentClub() club: ClubContext): Promise<StaffCandidate[]> {
    return this.staff.managerCandidates(club.tenantId);
  }

  @Get(':hallId')
  schedule(
    @CurrentClub() club: ClubContext,
    @Param('hallId') hallId: string,
    @Query() query: StaffScheduleQueryDto,
  ): Promise<StaffSchedule> {
    return this.staff.schedule(club, hallId, query.from);
  }

  @Put(':hallId/:date')
  setDay(
    @CurrentClub() club: ClubContext,
    @Param('hallId') hallId: string,
    @Param('date') date: string,
    @Body() dto: StaffDayDto,
  ): Promise<StaffSchedule> {
    return this.staff.setDay(club, hallId, date, dto.adminIds);
  }
}

/**
 * Можно ли открыть «Смену» — чтобы веб показал «сегодня вы не работаете»
 * до того, как администратор упрётся в отказ на первом же действии.
 */
@Roles('ADMIN', 'MANAGER', 'OWNER')
@Controller('clubs/:slug/desk-access')
export class DeskAccessController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  access(@CurrentClub() club: ClubContext, @Query() query: DeskAccessQueryDto): Promise<DeskAccess> {
    return this.staff.deskAccess(club, query.hallId ?? null);
  }
}
