import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { CreateBookingRequest, CreateSparringRequest } from '@yenisey/types';
import { CLOSE_MINUTE, OPEN_MINUTE } from '../availability';

/**
 * Потолок длительности — весь операционный день целиком.
 *
 * Не паранойя: без него запрос на миллион минут дойдёт до расчёта цены, и
 * клиент увидит счёт в несколько миллионов рублей вместо внятного отказа.
 */
const MAX_DURATION = CLOSE_MINUTE - OPEN_MINUTE;

/** Строка запроса приходит текстом; «true» и «1» одинаково означают да. */
const asBoolean = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value === 'true' || value === '1' : value,
  ) as PropertyDecorator;

const asInt = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() !== '' ? Number(value) : value,
  ) as PropertyDecorator;

export class CreateBookingDto implements CreateBookingRequest {
  @IsString()
  @MaxLength(64)
  tableId: string;

  @IsISO8601({ strict: true }, { message: 'Момент начала указывается в формате ISO-8601' })
  startsAt: string;

  @IsInt({ message: 'Длительность указывается целым числом минут' })
  @Min(1, { message: 'Длительность брони должна быть больше нуля' })
  @Max(MAX_DURATION, { message: 'Забронировать можно с 06:00 до полуночи' })
  durationMinutes: number;

  @IsBoolean()
  withRobot: boolean;
}

/** Запрос цены до подтверждения брони. Приходит строкой запроса, не телом. */
export class QuoteQueryDto {
  @IsString()
  @MaxLength(64)
  hallId: string;

  @asInt()
  @IsInt({ message: 'Длительность указывается целым числом минут' })
  @Min(1, { message: 'Длительность брони должна быть больше нуля' })
  @Max(MAX_DURATION, { message: 'Забронировать можно с 06:00 до полуночи' })
  durationMinutes: number;

  @asBoolean()
  @IsBoolean()
  withRobot: boolean;
}

/**
 * Спарринг тренера. Ученик и тип — вместе или ни одного (решение владельца от
 * 26.09.2026); проверяет сервис. Отдельным классом, а не полями клиентской
 * брони: клиент ученика себе не назначает, и `forbidNonWhitelisted` отвечает
 * ему отказом.
 */
export class CreateSparringDto extends CreateBookingDto implements CreateSparringRequest {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  studentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sparringTypeId?: string;
}

/** Цена спарринга с учеником — до брони. */
export class SparringQuoteQueryDto {
  @IsString()
  @MaxLength(64)
  sparringTypeId: string;

  @asInt()
  @IsInt({ message: 'Длительность указывается целым числом минут' })
  @Min(1, { message: 'Длительность брони должна быть больше нуля' })
  @Max(MAX_DURATION, { message: 'Забронировать можно с 06:00 до полуночи' })
  durationMinutes: number;
}
