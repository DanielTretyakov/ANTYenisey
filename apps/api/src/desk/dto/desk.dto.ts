import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type {
  BookingStatus,
  CancelDeskBookingRequest,
  CreateDeskBookingRequest,
  MoveDeskBookingRequest,
} from '@yenisey/types';
import { CLOSE_MINUTE, OPEN_MINUTE } from '../../booking/availability';

/**
 * Потолок длительности — весь операционный день целиком. Тот же, что у
 * клиентской заявки: администратор бронирует дольше, но не длиннее суток.
 */
const MAX_DURATION = CLOSE_MINUTE - OPEN_MINUTE;

const asInt = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() !== '' ? Number(value) : value,
  ) as PropertyDecorator;

const STATUSES: BookingStatus[] = ['BOOKED', 'CANCELLED', 'ATTENDED', 'NO_SHOW'];

export class CreateDeskBookingDto implements CreateDeskBookingRequest {
  @IsString()
  @MaxLength(64)
  clientId: string;

  @IsString()
  @MaxLength(64)
  tableId: string;

  @IsISO8601({ strict: true }, { message: 'Момент начала указывается в формате ISO-8601' })
  startsAt: string;

  @IsInt({ message: 'Длительность указывается целым числом минут' })
  @Min(1, { message: 'Длительность брони должна быть больше нуля' })
  @Max(MAX_DURATION, { message: 'Бронь не может быть длиннее операционного дня' })
  durationMinutes: number;

  @IsBoolean()
  withRobot: boolean;
}

export class MoveDeskBookingDto implements MoveDeskBookingRequest {
  @IsString()
  @MaxLength(64)
  tableId: string;

  @IsISO8601({ strict: true }, { message: 'Момент начала указывается в формате ISO-8601' })
  startsAt: string;

  @IsInt({ message: 'Длительность указывается целым числом минут' })
  @Min(1, { message: 'Длительность брони должна быть больше нуля' })
  @Max(MAX_DURATION, { message: 'Бронь не может быть длиннее операционного дня' })
  durationMinutes: number;
}

export class CancelDeskBookingDto implements CancelDeskBookingRequest {
  @IsOptional()
  @IsBoolean()
  waiveCharge?: boolean;
}

/**
 * Фильтры списка броней клуба.
 *
 * Диапазон дат, а не одна дата: этот список открывают, чтобы разобраться
 * («когда он последний раз не пришёл?»), а не чтобы работать в смену — для
 * смены есть свой экран.
 */
export class DeskBookingsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  hallId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientId?: string;

  @IsOptional()
  @IsIn(STATUSES, { message: 'Неизвестный статус брони' })
  status?: BookingStatus;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'Дата указывается в виде 2026-03-12' })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'Дата указывается в виде 2026-03-12' })
  to?: string;

  @IsOptional()
  @asInt()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
