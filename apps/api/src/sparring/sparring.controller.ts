import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { SparringStudent, SparringType } from '@yenisey/types';
import type { ClubContext } from '../auth/club-context';
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { SparringTypeDto, StudentSearchDto } from './dto/sparring.dto';
import { SparringService } from './sparring.service';

/**
 * Конструктор типов спаррингов — в «Каталоге услуг», рядом с видами занятий
 * и тарифами абонементов. Читает и тренер: он выбирает тип при брони.
 */
@Controller('clubs/:slug/sparring-types')
export class SparringTypesController {
  constructor(private readonly sparring: SparringService) {}

  @Roles('ADMIN', 'MANAGER', 'OWNER', 'COACH')
  @Get()
  list(@CurrentClub() club: ClubContext): Promise<SparringType[]> {
    return this.sparring.list(club.tenantId);
  }

  @Roles('ADMIN', 'MANAGER', 'OWNER')
  @Post()
  create(@CurrentClub() club: ClubContext, @Body() dto: SparringTypeDto): Promise<SparringType> {
    return this.sparring.create(club.tenantId, dto);
  }

  @Roles('ADMIN', 'MANAGER', 'OWNER')
  @Patch(':id')
  update(
    @CurrentClub() club: ClubContext,
    @Param('id') id: string,
    @Body() dto: SparringTypeDto,
  ): Promise<SparringType> {
    return this.sparring.update(club.tenantId, id, dto);
  }
}

/** Ученик для спарринга — поиск тренера среди людей клуба. */
@Roles('COACH')
@Controller('clubs/:slug/coach/students')
export class CoachStudentsController {
  constructor(private readonly sparring: SparringService) {}

  @Get()
  search(@CurrentClub() club: ClubContext, @Query() query: StudentSearchDto): Promise<SparringStudent[]> {
    return this.sparring.students(club.tenantId, club.userId, query.search, query.limit);
  }
}
