import { Body, Controller, Delete, Get, Param, Patch, Put, Req, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { CoachGroup, CoachProfile, PublicCoach } from '@yenisey/types';
import type { ClubContext } from '../auth/club-context';
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { SingleFileUpload, uploadedBytes } from '../files/single-file-upload.interceptor';
import { CoachesService } from './coaches.service';
import { UpdateCoachProfileDto } from './dto/coach.dto';

/** Те же соображения, что у загрузки аватара: каждая — `sharp` на сотни миллисекунд. */
const UPLOAD_LIMIT = { default: { limit: 20, ttl: 60_000 } };

/**
 * Своя карточка тренера и свои группы.
 *
 * Клуб в адресе обязателен: карточка принадлежит клубу, а не человеку, и роль
 * без клуба не спрашивается — её даёт `ClubContextGuard` по этому же адресу.
 */
@Roles('COACH')
@Controller('clubs/:slug/coach')
export class MeCoachController {
  constructor(private readonly coaches: CoachesService) {}

  @Get()
  profile(@CurrentClub() club: ClubContext): Promise<CoachProfile> {
    return this.coaches.profile(club.tenantId, club.userId);
  }

  @Patch()
  update(@CurrentClub() club: ClubContext, @Body() dto: UpdateCoachProfileDto): Promise<CoachProfile> {
    return this.coaches.update(club.tenantId, club.userId, dto);
  }

  /** Фотография — файлом в поле `file`. PUT: новая заменяет старую целиком. */
  @Throttle(UPLOAD_LIMIT)
  @Put('photo')
  @UseInterceptors(SingleFileUpload)
  setPhoto(@CurrentClub() club: ClubContext, @Req() request: AuthenticatedRequest): Promise<CoachProfile> {
    return this.coaches.setPhoto(club.tenantId, club.userId, uploadedBytes(request));
  }

  @Delete('photo')
  removePhoto(@CurrentClub() club: ClubContext): Promise<CoachProfile> {
    return this.coaches.removePhoto(club.tenantId, club.userId);
  }

  /** Свои занятия вместе с составом записавшихся. */
  @Get('groups')
  groups(@CurrentClub() club: ClubContext): Promise<CoachGroup[]> {
    return this.coaches.myGroups(club.tenantId, club.userId);
  }
}

/**
 * Карточка любого тренера своего клуба — правит администратор. Роли на классе:
 * маршрут, добавленный сюда завтра, окажется закрытым по умолчанию.
 *
 * Чтения здесь нет: карточку администратор получает вместе с карточкой
 * человека, одним запросом.
 */
@Roles('ADMIN', 'OWNER')
@Controller('clubs/:slug/coaches/:id')
export class CoachAdminController {
  constructor(private readonly coaches: CoachesService) {}

  @Patch()
  update(
    @CurrentClub() club: ClubContext,
    @Param('id') coachId: string,
    @Body() dto: UpdateCoachProfileDto,
  ): Promise<CoachProfile> {
    return this.coaches.update(club.tenantId, coachId, dto);
  }

  @Throttle(UPLOAD_LIMIT)
  @Put('photo')
  @UseInterceptors(SingleFileUpload)
  setPhoto(
    @CurrentClub() club: ClubContext,
    @Param('id') coachId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<CoachProfile> {
    return this.coaches.setPhoto(club.tenantId, coachId, uploadedBytes(request));
  }

  @Delete('photo')
  removePhoto(@CurrentClub() club: ClubContext, @Param('id') coachId: string): Promise<CoachProfile> {
    return this.coaches.removePhoto(club.tenantId, coachId);
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
