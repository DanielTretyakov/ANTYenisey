import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { BookingStep, UpdateClubSettingsRequest } from '@yenisey/types';

const BOOKING_STEPS: BookingStep[] = ['MIN_10', 'MIN_15', 'MIN_20', 'MIN_30', 'HOUR_1'];

/**
 * Верхняя граница цены — 10 000 000 копеек (100 000 ₽ за час).
 *
 * Не паранойя: без потолка опечатка в форме («50000» вместо «500») уезжает в
 * базу молча, а увидит её клиент на этапе оплаты. Порог заведомо выше любой
 * осмысленной цены аренды стола.
 */
const MAX_PRICE = 10_000_000;

/** Целая неотрицательная сумма в копейках. */
const MoneyField = (): PropertyDecorator =>
  ((target: object, key: string | symbol) => {
    IsInt({ message: `${String(key)}: сумма указывается целым числом копеек` })(target, key);
    Min(0, { message: `${String(key)}: сумма не может быть отрицательной` })(target, key);
    Max(MAX_PRICE, { message: `${String(key)}: сумма неправдоподобно велика` })(target, key);
  }) as PropertyDecorator;

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
  @IsIn(BOOKING_STEPS, { message: 'bookingStep: недопустимый шаг бронирования' })
  bookingStep?: BookingStep;

  @IsOptional()
  @MoneyField()
  tableHourPrice?: number;

  @IsOptional()
  @MoneyField()
  tableExtra30MinPrice?: number;

  @IsOptional()
  @IsBoolean()
  hasRobotOption?: boolean;

  // null — осмысленное значение: так цены робота стираются вместе с
  // выключением опции. Поэтому проверка суммы применяется только к не-null.
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @MoneyField()
  robot30MinPrice?: number | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @MoneyField()
  robot60MinPrice?: number | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @MoneyField()
  robotExtra30MinPrice?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100, { message: 'noShowChargePercent: процент лежит в диапазоне 0..100' })
  noShowChargePercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  // Сутки с запасом: напоминание позже этого срока уже бессмысленно.
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
