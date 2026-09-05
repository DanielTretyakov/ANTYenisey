import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { UpdateClubSettingsRequest } from '@yenisey/types';

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
