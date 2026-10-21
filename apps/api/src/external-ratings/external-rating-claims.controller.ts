import { Body, Controller, Delete, Get, Param, ParseEnumPipe, Post } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import { RatingSystem } from '@yenisey/database';
import type { MyExternalRatings } from '@yenisey/types';
import { Acting, ClientAction, type ActingClient } from '../guardianship/acting-client.guard';
import { ExternalRatingClaimsService } from './external-rating-claims.service';

class ClaimDto {
  @IsString()
  @Matches(/^[0-9A-Za-z_-]{1,40}$/, { message: 'Неверный идентификатор профиля' })
  externalId: string;
}

/**
 * «Выберите себя» в кабинете. Профиль игрока ведёт сам человек, а до 14 —
 * родитель (`?for=`), поэтому маршруты — рядом с `/me/player` и под тем же
 * `ActingClientGuard`.
 */
@Controller('me/player/external-ratings')
export class ExternalRatingClaimsController {
  constructor(private readonly claims: ExternalRatingClaimsService) {}

  @ClientAction('read')
  @Get()
  mine(@Acting() acting: ActingClient): Promise<MyExternalRatings> {
    return this.claims.mine(acting.userId);
  }

  @ClientAction()
  @Post(':system/claim')
  claim(
    @Acting() acting: ActingClient,
    @Param('system', new ParseEnumPipe(RatingSystem)) system: RatingSystem,
    @Body() dto: ClaimDto,
  ): Promise<MyExternalRatings> {
    return this.claims.claim(acting.userId, system, dto.externalId);
  }

  @ClientAction()
  @Delete(':system/claim')
  unclaim(
    @Acting() acting: ActingClient,
    @Param('system', new ParseEnumPipe(RatingSystem)) system: RatingSystem,
  ): Promise<MyExternalRatings> {
    return this.claims.unclaim(acting.userId, system);
  }
}
