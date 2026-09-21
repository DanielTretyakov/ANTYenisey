import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  AdjustSubscriptionRequest,
  ClubLedgerQuery,
  IssueSubscriptionRequest,
  SubscriptionPlanRequest,
} from '@yenisey/types';

/**
 * Тариф абонемента. Визиты и срок — числа или null («без предела»); что оба
 * сразу пустыми не бывают, держит CHECK `SubscriptionPlan_terms_sane`, а здесь
 * — внятный ответ до него.
 */
export class SubscriptionPlanDto implements SubscriptionPlanRequest {
  @IsString()
  @MaxLength(100, { message: 'Название — не длиннее 100 символов' })
  name: string;

  @ValidateIf((dto: SubscriptionPlanDto) => dto.visitsCount !== null)
  @IsInt({ message: 'Визиты — целым числом' })
  @Min(1, { message: 'Визитов — хотя бы один, или безлимит' })
  @Max(1000, { message: 'Визитов — не больше 1000' })
  visitsCount: number | null;

  @ValidateIf((dto: SubscriptionPlanDto) => dto.durationDays !== null)
  @IsInt({ message: 'Срок — целым числом дней' })
  @Min(1, { message: 'Срок — хотя бы один день, или бессрочно' })
  @Max(3650, { message: 'Срок — не больше десяти лет' })
  durationDays: number | null;

  @IsInt({ message: 'Цена — в копейках, целым числом' })
  @Min(0, { message: 'Цена не бывает отрицательной' })
  @Max(100_000_000, { message: 'Цена — не больше миллиона рублей' })
  price: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  trainingTypeIds: string[];

  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  tournamentTypeIds: string[];
}

export class IssueSubscriptionDto implements IssueSubscriptionRequest {
  @IsString()
  @MaxLength(64)
  planId: string;

  /** Не прислан — клуб с одним залом; с несколькими сервис откажет. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  hallId?: string;
}

/** Корректировка визитов или досрочное закрытие безлимита — с причиной. */
export class AdjustSubscriptionDto implements AdjustSubscriptionRequest {
  @IsOptional()
  @IsInt({ message: 'Корректировка — целым числом визитов' })
  @Min(-1000)
  @Max(1000)
  delta?: number;

  @IsOptional()
  @IsBoolean()
  close?: boolean;

  @IsString()
  @MaxLength(500, { message: 'Причина — не длиннее 500 символов' })
  reason: string;
}

/**
 * Фильтр истории абонементов клуба. Числа приходят строками из адреса, поэтому
 * `@Type(() => Number)`: без него `limit=50` не прошёл бы `@IsInt`.
 */
export class ClubLedgerQueryDto implements ClubLedgerQuery {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  personId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Поиск — не длиннее 100 символов' })
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
