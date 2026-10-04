import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class PlanChoiceDto {
  @IsString()
  @MaxLength(64)
  planId!: string;
}

/** Реквизиты клуба для счетов и актов. Формат держит и CHECK ClubRequisites_sane. */
export class RequisitesDto {
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  legalName!: string;

  @Matches(/^\s*([0-9]{10}|[0-9]{12})\s*$/, { message: 'ИНН — 10 цифр у организации или 12 у ИП' })
  inn!: string;

  @IsOptional()
  @Matches(/^\s*([0-9]{9})?\s*$/, { message: 'КПП — 9 цифр' })
  kpp?: string | null;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  address!: string;

  @IsEmail({}, { message: 'Почта для счетов и актов — адрес почты' })
  email!: string;
}

export class AutoRenewDto {
  @IsBoolean()
  autoRenew!: boolean;
}

export class ExemptDto {
  @IsBoolean()
  exempt!: boolean;
}

export class ExtendDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  days!: number;
}

/** Отладочный проход джобы: «сейчас» и, по желанию, один клуб. */
export class DevBillingRunDto {
  @IsOptional()
  @IsISO8601()
  now?: string;

  @IsOptional()
  @IsString()
  slug?: string;
}

export class DevNextChargeDto {
  @IsIn(['succeeded', 'canceled'])
  result!: 'succeeded' | 'canceled';
}

/** Пробный клуб смоука: кто руководитель и кто клиент с бронью. */
export class DevProbeClubDto {
  @IsString()
  ownerId!: string;

  @IsString()
  clientId!: string;
}
