import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type {
  TournamentRequest,
  TournamentTypeRequest,
  TrainingTypeRequest,
} from '@yenisey/types';

/** Тот же потолок, что у цен зала: опечатка в форме иначе уезжает в базу молча. */
const MAX_PRICE = 10_000_000;

const trimmed = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class TrainingTypeDto implements TrainingTypeRequest {
  @IsString()
  @trimmed()
  @MinLength(1, { message: 'У типа тренировки должно быть название' })
  @MaxLength(120)
  name: string;

  @IsInt({ message: 'Цена указывается целым числом копеек' })
  @Min(0, { message: 'Цена не может быть отрицательной' })
  @Max(MAX_PRICE, { message: 'Цена неправдоподобно велика' })
  price: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class TournamentTypeDto implements TournamentTypeRequest {
  @IsString()
  @trimmed()
  @MinLength(1, { message: 'У типа турнира должно быть название' })
  @MaxLength(120)
  name: string;

  /**
   * Число-ограничение по рейтингу из названия («100» у «Клуб 100»).
   *
   * Строкой, а не числом: система его не проверяет и допуск не блокирует — это
   * справочная информация для спортсмена (ТЗ → «Запись на турнир»), и клуб
   * вправе написать там что угодно.
   */
  @IsOptional()
  @IsString()
  @trimmed()
  @MaxLength(32)
  ratingLabel?: string | null;

  @IsInt({ message: 'Цена указывается целым числом копеек' })
  @Min(0, { message: 'Цена не может быть отрицательной' })
  @Max(MAX_PRICE, { message: 'Цена неправдоподобно велика' })
  price: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class TournamentDto implements TournamentRequest {
  @IsString()
  @MaxLength(64)
  tournamentTypeId: string;

  @IsISO8601({ strict: true }, { message: 'Начало указывается моментом времени в ISO-8601' })
  startsAt: string;
}
