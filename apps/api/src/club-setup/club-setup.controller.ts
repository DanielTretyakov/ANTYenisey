import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import type { AccessTokenPayload, ClubCreateRequest, ClubOpening } from '@yenisey/types';
import type { ClubContext } from '../auth/club-context';
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ClubSetupService } from './club-setup.service';

export class ClubCreateDto implements ClubCreateRequest {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsString()
  @MaxLength(40)
  slug!: string;

  @IsString()
  @MaxLength(64)
  cityId!: string;

  @IsEmail({}, { message: 'Почта руководителя — адресом вида name@example.ru' })
  @MaxLength(254)
  ownerEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  applicationId?: string;
}

export class PublishedDto {
  @IsBoolean()
  published!: boolean;
}

/**
 * Владелец платформы заводит клуб и открывает или закрывает его (решения
 * владельца от 11.10.2026). Клуба в адресе нет у заведения — владельца
 * проверяет сервис, как у новостей и подписок.
 */
@Controller('platform/club-setup')
export class PlatformClubSetupController {
  constructor(private readonly setup: ClubSetupService) {}

  @Post()
  async create(@CurrentUser() user: AccessTokenPayload, @Body() dto: ClubCreateDto): Promise<{ slug: string }> {
    await this.setup.assertPlatformOwner(user.sub);
    return this.setup.create(dto);
  }

  @Put(':club/published')
  async published(
    @CurrentUser() user: AccessTokenPayload,
    @Param('club') slug: string,
    @Body() dto: PublishedDto,
  ): Promise<ClubOpening> {
    await this.setup.assertPlatformOwner(user.sub);
    return this.setup.setPublished(slug, dto.published);
  }
}

/**
 * Открытие клуба его руководителем — с проверкой «что ещё нужно». Открыть
 * может и черновик: `ClubContextGuard` пускает в черновик своих.
 */
@Roles('OWNER')
@Controller('clubs/:slug/opening')
export class ClubOpeningController {
  constructor(private readonly setup: ClubSetupService) {}

  @Get()
  opening(@CurrentClub() club: ClubContext): Promise<ClubOpening> {
    return this.setup.opening(club.tenantId);
  }

  @HttpCode(HttpStatus.OK)
  @Post()
  publish(@CurrentClub() club: ClubContext): Promise<ClubOpening> {
    return this.setup.publish(club.tenantId);
  }
}
