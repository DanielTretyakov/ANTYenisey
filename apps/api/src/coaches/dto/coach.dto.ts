import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import {
  MAX_COACH_SOCIAL_LINKS,
  type CoachSocialLink,
  type UpdateCoachProfileRequest,
} from '@yenisey/types';

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
 * Карточка тренера. Поле не прислано — не трогается; прислано пустым или
 * null — стирается, как в инвентаре игрока.
 */
export class UpdateCoachProfileDto implements UpdateCoachProfileRequest {
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Достижения — не длиннее 2000 символов' })
  achievements?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Инвентарь — не длиннее 1000 символов' })
  inventory?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Стоимость — не длиннее 500 символов' })
  priceInfo?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_COACH_SOCIAL_LINKS, { message: `Ссылок — не больше ${MAX_COACH_SOCIAL_LINKS}` })
  @ValidateNested({ each: true })
  @Type(() => CoachSocialLinkDto)
  socialLinks?: CoachSocialLinkDto[];
}
