import { Body, Controller, Get, Put, Query, Req } from '@nestjs/common';
import type { AccessTokenPayload, ClubRating } from '@yenisey/types';
import type { ClubContext } from '../auth/club-context';
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';
import { RatingQueryDto, RatingVisibilityDto } from './dto/rating.dto';
import { RatingService } from './rating.service';

/**
 * Рейтинг посещений клуба — открыт без входа (решение владельца от
 * 26.09.2026). Вошедшему — ещё его место и выключатель.
 */
@Controller('clubs/:slug/rating')
export class RatingController {
  constructor(private readonly rating: RatingService) {}

  @Public()
  @Get()
  get(
    @CurrentClub() club: ClubContext,
    @Req() request: AuthenticatedRequest,
    @Query() query: RatingQueryDto,
  ): Promise<ClubRating> {
    return this.rating.rating(club.tenantId, query.period ?? 'month', request.user?.sub ?? null, query.gender ?? null);
  }
}

/** «Не показывать меня в рейтингах» — флаг человека, во всех клубах сразу. */
@Controller('me/rating')
export class MeRatingController {
  constructor(private readonly rating: RatingService) {}

  @Put()
  set(@CurrentUser() user: AccessTokenPayload, @Body() dto: RatingVisibilityDto): Promise<{ hidden: boolean }> {
    return this.rating.setHidden(user.sub, dto.hidden);
  }
}
