import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { AddressSuggestion } from '@yenisey/types';
import type { ClubContext } from '../auth/club-context';
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AddressProvider } from './address.provider';

export class AddressQueryDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2, { message: 'query: хотя бы два символа' })
  @MaxLength(120)
  query: string;

  /** Город зала из справочника платформы — подсказки только в нём. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  cityId?: string;
}

/**
 * Подсказки адреса для формы зала.
 *
 * Клубный маршрут и только для администраторов: у DaData суточный лимит на
 * весь продукт, и открытый маршрут выбрал бы его чужими руками. Частота —
 * отдельным ограничением: форма шлёт запрос на каждую паузу в наборе.
 */
@Roles('ADMIN', 'OWNER')
@Controller('clubs/:slug/address-suggestions')
export class AddressController {
  constructor(
    private readonly provider: AddressProvider,
    private readonly prisma: PrismaService,
  ) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get()
  async suggest(@CurrentClub() _club: ClubContext, @Query() dto: AddressQueryDto): Promise<AddressSuggestion[]> {
    const city = dto.cityId
      ? ((await this.prisma.city.findUnique({ where: { id: dto.cityId }, select: { name: true } }))?.name ?? null)
      : null;

    return this.provider.suggest(dto.query, city);
  }
}
