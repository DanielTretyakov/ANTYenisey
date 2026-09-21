import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  COACH_STATS_PERIODS,
  MAX_COACH_SOCIAL_LINKS,
  type CoachSocialLink,
  type CoachStatsPeriod,
  type UpdateCoachCardRequest,
  type UpdateCoachPricesRequest,
} from '@yenisey/types';

/**
 * Срок статистики. Из адреса приходит строкой, поэтому сначала число, потом
 * проверка по списку: произвольный срок («за 17 дней») ничего не объясняет и
 * только множит варианты одной и той же цифры. Не прислан — 90 дней.
 */
export class CoachStatsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsIn(COACH_STATS_PERIODS, { message: 'Срок — 30, 90 или 365 дней, либо 0 — за всё время' })
  period?: CoachStatsPeriod;
}

/**
 * Ссылка на соцсеть. Что адрес — именно http(s), проверяет `parseSocialLinks`:
 * `@IsUrl` пропускает `javascript:` в ряде версий, а решение об адресе нужно
 * и тестам правил, и форме.
 */
export class CoachSocialLinkDto implements CoachSocialLink {
  @IsString()
  @MaxLength(50, { message: 'Подпись ссылки — не длиннее 50 символов' })
  label: string;

  @IsString()
  @MaxLength(300, { message: 'Адрес ссылки — не длиннее 300 символов' })
  url: string;
}

/**
 * Карточка тренера — одна на все клубы. Поле не прислано — не трогается;
 * прислано пустым или null — стирается, как в инвентаре игрока.
 */
export class UpdateCoachCardDto implements UpdateCoachCardRequest {
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Достижения — не длиннее 2000 символов' })
  achievements?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Инвентарь — не длиннее 1000 символов' })
  inventory?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_COACH_SOCIAL_LINKS, { message: `Ссылок — не больше ${MAX_COACH_SOCIAL_LINKS}` })
  @ValidateNested({ each: true })
  @Type(() => CoachSocialLinkDto)
  socialLinks?: CoachSocialLinkDto[];
}

/**
 * Цены тренера в одном клубе, копейки. Пусто — цена не указана: у тренера
 * может не быть, например, индивидуальных занятий.
 */
export class UpdateCoachPricesDto implements UpdateCoachPricesRequest {
  @IsOptional()
  @IsInt({ message: 'Цена — в копейках, целым числом' })
  @Min(0, { message: 'Цена не бывает отрицательной' })
  @Max(100_000_000, { message: 'Цена — не больше миллиона рублей' })
  groupPrice: number | null;

  @IsOptional()
  @IsInt({ message: 'Цена — в копейках, целым числом' })
  @Min(0, { message: 'Цена не бывает отрицательной' })
  @Max(100_000_000, { message: 'Цена — не больше миллиона рублей' })
  individualPrice: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(300, { message: 'Примечание — не длиннее 300 символов' })
  priceNote: string | null;
}
