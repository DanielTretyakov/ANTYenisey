import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { ClubValue, UpdateClubSettingsRequest } from '@yenisey/types';

/**
 * Ценность клуба. Пределы длины здесь с запасом: точные и с понятной
 * формулировкой проверяет `parseClubValues`, а тут — лишь чтобы мегабайт
 * текста не доехал до правил.
 */
export class ClubValueDto implements ClubValue {
  @IsString()
  @MaxLength(1000)
  title: string;

  @IsString()
  @MaxLength(1000)
  text: string;
}

/**
 * Правка настроек клуба.
 *
 * Цен и шага бронирования здесь нет: они у зала (см. schedule.dto.ts). Тут
 * остаётся то, что составляет договор клуба с клиентом и не должно
 * различаться между его залами.
 */
export class UpdateClubSettingsDto implements UpdateClubSettingsRequest {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  name?: string;

  // Часового пояса здесь нет: он переехал на зал. Залы одной организации
  // бывают в разных регионах, и общий на клуб пояс сдвинул бы в одном из них
  // границы операционного дня и порог «за час до начала».

  /** Основной город клуба: идентификатор из справочника платформы, не строка. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  cityId?: string | null;

  /**
   * Телефон клуба в том же формате, что у человека: он уходит в ссылку `tel:`,
   * и «8 (391) …» из неё дозванивается не везде. Пустая строка означает «убрать
   * номер», поэтому она превращается в null, а не падает на формате.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() === '' ? null : value,
  )
  @Matches(/^\+7[0-9]{10}$/, {
    message: 'phone: телефон в формате +79991234567',
  })
  phone?: string | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() === '' ? null : value,
  )
  @Matches(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, { message: 'email: ожидается адрес почты' })
  @MaxLength(200)
  email?: string | null;

  /**
   * Описание клуба. Пусто и пробелы — стереть (null): CHECK
   * Tenant_description_sane другого не примет.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  @IsString()
  @MaxLength(2000, { message: 'description: не длиннее 2000 символов' })
  description?: string | null;

  /** Ценности — список целиком; пустой — убрать блок. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ClubValueDto)
  values?: ClubValueDto[];

  /**
   * Ссылки ВКонтакте и MAX. Домен, схему и путь проверяет `parseSocialUrl` —
   * он же дописывает https к скопированному «vk.com/…». Пустое — убрать.
   */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  vkUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  maxUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string | null;

  /**
   * Фирменный цвет. Формат проверяется и здесь, и CHECK'ом в базе: значение
   * уезжает прямо в CSS-переменную страницы клуба, и мусор в нём означал бы
   * сломанную вёрстку, а не пустое поле.
   */
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, {
    message: 'accentColor: ожидается цвет вида «#126b54»',
  })
  accentColor?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100, { message: 'noShowChargePercent: процент лежит в диапазоне 0..100' })
  noShowChargePercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  // Неделя с запасом: напоминание позже этого срока уже бессмысленно.
  @Max(10_080)
  attendanceReminderAfterMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_080)
  attendanceAutoNoShowAfterMinutes?: number;

  @IsOptional()
  @IsBoolean()
  subscriptionBurnsOnNoShowOnly?: boolean;
}
