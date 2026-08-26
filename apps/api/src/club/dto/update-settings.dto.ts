import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
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

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

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
