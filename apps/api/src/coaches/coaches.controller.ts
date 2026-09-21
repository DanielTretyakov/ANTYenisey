import { Body, Controller, Delete, Get, Param, Patch, Put, Query, Req, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { CoachCard, CoachGroup, CoachPrices, CoachStats, PublicCoach } from '@yenisey/types';
import type { ClubContext } from '../auth/club-context';
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { SingleFileUpload, uploadedBytes } from '../files/single-file-upload.interceptor';
import { CoachesService } from './coaches.service';
import { CoachStatsQueryDto, UpdateCoachCardDto, UpdateCoachPricesDto } from './dto/coach.dto';

/** Те же соображения, что у загрузки аватара: каждая — `sharp` на сотни миллисекунд. */
const UPLOAD_LIMIT = { default: { limit: 20, ttl: 60_000 } };

/**
 * Своя карточка тренера — одна на все клубы, поэтому клуба в адресе нет.
 *
 * Роль здесь не спрашивается guard'ом: без клуба ему нечего проверять.
 * «Тренер хотя бы одного клуба» проверяет сервис; посторонний получает 403.
 */
@Controller('me/coach-card')
export class MeCoachCardController {
  constructor(private readonly coaches: CoachesService) {}

  @Get()
  card(@Req() request: AuthenticatedRequest): Promise<CoachCard> {
    return this.coaches.card(request.user!.sub);
  }

  @Patch()
  update(@Req() request: AuthenticatedRequest, @Body() dto: UpdateCoachCardDto): Promise<CoachCard> {
    return this.coaches.updateCard(request.user!.sub, dto);
  }

  /** Фотография — файлом в поле `file`. PUT: новая заменяет старую целиком. */
  @Throttle(UPLOAD_LIMIT)
  @Put('photo')
  @UseInterceptors(SingleFileUpload)
  setPhoto(@Req() request: AuthenticatedRequest): Promise<CoachCard> {
    return this.coaches.setPhoto(request.user!.sub, uploadedBytes(request));
  }

  @Delete('photo')
  removePhoto(@Req() request: AuthenticatedRequest): Promise<CoachCard> {
    return this.coaches.removePhoto(request.user!.sub);
  }
}

/**
 * Цены и группы тренера В ЭТОМ клубе.
 *
 * Цены клубные: в соседнем клубе у того же человека другой прайс. Правит их
 * сам тренер — администратор в карточку и цены не лезет (решение владельца от
 * 20.09.2026, отступление от ТЗ).
 */
@Roles('COACH')
@Controller('clubs/:slug/coach')
export class MeCoachController {
  constructor(private readonly coaches: CoachesService) {}

  @Get('prices')
  prices(@CurrentClub() club: ClubContext): Promise<CoachPrices> {
    return this.coaches.prices(club.tenantId, club.userId);
  }

  @Patch('prices')
  updatePrices(@CurrentClub() club: ClubContext, @Body() dto: UpdateCoachPricesDto): Promise<CoachPrices> {
    return this.coaches.updatePrices(club.tenantId, club.userId, dto);
  }

  /** Свои занятия вместе с составом записавшихся. */
  @Get('groups')
  groups(@CurrentClub() club: ClubContext): Promise<CoachGroup[]> {
    return this.coaches.myGroups(club.tenantId, club.userId);
  }

  /** Своя статистика по проведённым занятиям этого клуба. */
  @Get('stats')
  stats(@CurrentClub() club: ClubContext, @Query() query: CoachStatsQueryDto): Promise<CoachStats> {
    return this.coaches.stats(club.tenantId, club.userId, query.period ?? 90);
  }
}

/**
 * Статистика тренера глазами клуба — единственное, что администратор о нём
 * спрашивает отдельно. ТЗ просит её в разделе CRM; карточку он только видит,
 * вместе с карточкой человека.
 */
@Roles('ADMIN', 'OWNER')
@Controller('clubs/:slug/coaches/:id')
export class CoachAdminController {
  constructor(private readonly coaches: CoachesService) {}

  @Get('stats')
  stats(
    @CurrentClub() club: ClubContext,
    @Param('id') coachId: string,
    @Query() query: CoachStatsQueryDto,
  ): Promise<CoachStats> {
    return this.coaches.stats(club.tenantId, coachId, query.period ?? 90);
  }
}

/** Публичная страница тренера. Открыта без входа — возраста у неё нет. */
@Controller('coaches')
export class CoachesController {
  constructor(private readonly coaches: CoachesService) {}

  @Public()
  @Get(':id')
  coach(@Param('id') id: string): Promise<PublicCoach> {
    return this.coaches.publicProfile(id);
  }
}
