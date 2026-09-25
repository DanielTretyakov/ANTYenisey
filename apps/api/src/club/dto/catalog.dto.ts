import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
  TrainingSessionRequest,
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

  /**
   * Описание для окна мероприятия. Потолок — тот же, что у CHECK в
   * constraints.sql (раздел 24): форма должна отказать раньше базы.
   */
  @IsOptional()
  @IsString()
  @trimmed()
  @MaxLength(2000, { message: 'Описание — не длиннее 2000 символов' })
  description?: string | null;

  /** Залы, где идёт вид; пусто — во всех. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  hallIds?: string[];
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

  /**
   * Описание для окна мероприятия. Потолок — тот же, что у CHECK в
   * constraints.sql (раздел 24): форма должна отказать раньше базы.
   */
  @IsOptional()
  @IsString()
  @trimmed()
  @MaxLength(2000, { message: 'Описание — не длиннее 2000 символов' })
  description?: string | null;

  /** Залы, где идёт вид; пусто — во всех. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  hallIds?: string[];
}

export class TournamentDto implements TournamentRequest {
  @IsString()
  @MaxLength(64)
  tournamentTypeId: string;

  @IsISO8601({ strict: true }, { message: 'Начало указывается моментом времени в ISO-8601' })
  startsAt: string;

  /**
   * Окончание турнира. Без него ни экран смены, ни джоба автонеявки не знают,
   * когда турнир закончился. Порядок моментов проверяет сервис.
   */
  @IsISO8601({ strict: true }, { message: 'Окончание указывается моментом времени в ISO-8601' })
  endsAt: string;
}

export class TrainingSessionDto implements TrainingSessionRequest {
  @IsString()
  @MaxLength(64)
  trainingTypeId: string;

  @IsString()
  @MaxLength(64)
  coachId: string;

  @IsISO8601({ strict: true }, { message: 'Начало указывается моментом времени в ISO-8601' })
  startsAt: string;

  /**
   * Окончание занятия. У турнира такого поля нет, у занятия есть: группа
   * собирается на известный отрезок, и от него зависит, чем в это время занят
   * стол. Порядок моментов проверяет сервис — здесь нечем сравнить два поля.
   */
  @IsISO8601({ strict: true }, { message: 'Окончание указывается моментом времени в ISO-8601' })
  endsAt: string;

  /**
   * Потолок мест намеренно грубый. Он не про размер зала — сколько человек
   * влезет, знает тренер, — а про опечатку в форме: «100» вместо «10» пройдёт,
   * а «1000» уже нет.
   */
  @IsInt({ message: 'Мест указывается целым числом' })
  @Min(1, { message: 'В группе должно быть хотя бы одно место' })
  @Max(200, { message: 'Слишком много мест для одной группы' })
  capacity: number;
}
