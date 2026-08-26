import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type {
  BookingStep,
  ClosurePurpose,
  ClosureRuleDraft,
  CreateHallRequest,
  CreateTableRequest,
  DayClosureDraft,
  RenameTableRequest,
  ReplaceDayRequest,
  ReplaceTemplateRequest,
  UpdateHallRequest,
  Weekday,
} from '@yenisey/types';
import { MINUTES_IN_DAY } from '../closures';

const BOOKING_STEPS: BookingStep[] = ['MIN_10', 'MIN_15', 'MIN_20', 'MIN_30', 'HOUR_1'];
const PURPOSES: ClosurePurpose[] = ['RENT', 'SPARRING', 'TRAINING', 'ROBOT', 'OTHER'];

/**
 * Верхняя граница цены — 10 000 000 копеек (100 000 ₽ за час).
 *
 * Не паранойя: без потолка опечатка в форме («50000» вместо «500») уезжает в
 * базу молча, а увидит её клиент на этапе оплаты.
 */
const MAX_PRICE = 10_000_000;

/** Целая неотрицательная сумма в копейках. */
const MoneyField = (): PropertyDecorator =>
  ((target: object, key: string | symbol) => {
    IsInt({ message: `${String(key)}: сумма указывается целым числом копеек` })(target, key);
    Min(0, { message: `${String(key)}: сумма не может быть отрицательной` })(target, key);
    Max(MAX_PRICE, { message: `${String(key)}: сумма неправдоподобно велика` })(target, key);
  }) as PropertyDecorator;

const trimmed = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

// ---------------------------------------------------------------------------
// Залы
// ---------------------------------------------------------------------------

export class CreateHallDto implements CreateHallRequest {
  @IsString()
  @trimmed()
  @MinLength(1, { message: 'У зала должно быть название' })
  @MaxLength(120)
  name: string;

  @IsIn(BOOKING_STEPS, { message: 'bookingStep: недопустимый шаг бронирования' })
  bookingStep: BookingStep;

  @MoneyField()
  tableHourPrice: number;

  @MoneyField()
  tableExtra30MinPrice: number;

  @IsBoolean()
  hasRobotOption: boolean;

  // null — осмысленное значение: так цены робота стираются вместе с
  // выключением опции. Поэтому проверка суммы применяется только к не-null.
  @IsOptional()
  @ValidateIfNotNull()
  @MoneyField()
  robot30MinPrice: number | null;

  @IsOptional()
  @ValidateIfNotNull()
  @MoneyField()
  robot60MinPrice: number | null;

  @IsOptional()
  @ValidateIfNotNull()
  @MoneyField()
  robotExtra30MinPrice: number | null;
}

/** Правка зала: форма шлёт только изменённое. */
export class UpdateHallDto implements UpdateHallRequest {
  @IsOptional()
  @IsString()
  @trimmed()
  @MinLength(1, { message: 'У зала должно быть название' })
  @MaxLength(120)
  name?: string;

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

  @IsOptional()
  @ValidateIfNotNull()
  @MoneyField()
  robot30MinPrice?: number | null;

  @IsOptional()
  @ValidateIfNotNull()
  @MoneyField()
  robot60MinPrice?: number | null;

  @IsOptional()
  @ValidateIfNotNull()
  @MoneyField()
  robotExtra30MinPrice?: number | null;
}

// ---------------------------------------------------------------------------
// Столы
// ---------------------------------------------------------------------------

export class CreateTableDto implements CreateTableRequest {
  @IsString()
  @MaxLength(64)
  hallId: string;

  /**
   * Название видит клиент при выборе стола, поэтому пустое и состоящее из
   * пробелов не годится. Лишние пробелы схлопываются здесь же: «Стол  1» и
   * «Стол 1» не должны быть разными столами в глазах уникального индекса.
   */
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  @MinLength(1, { message: 'Название стола не может быть пустым' })
  @MaxLength(64, { message: 'Название стола не длиннее 64 символов' })
  label: string;
}

export class RenameTableDto implements RenameTableRequest {
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  @MinLength(1, { message: 'Название стола не может быть пустым' })
  @MaxLength(64, { message: 'Название стола не длиннее 64 символов' })
  label: string;
}

// ---------------------------------------------------------------------------
// Расписание
// ---------------------------------------------------------------------------

/** Общая часть окна: границы, назначение, тренер. */
class ClosureSlotDto {
  @IsString()
  @MaxLength(64)
  tableId: string;

  @IsInt()
  @Min(0)
  // Начало не может совпасть с концом суток: окно нулевой длины бессмысленно,
  // а полночь как НАЧАЛО — это 0.
  @Max(MINUTES_IN_DAY - 1)
  startMinute: number;

  @IsInt()
  @Min(1)
  // Полночь как КОНЕЦ окна — это 1440, а не 0: иначе интервал вывернулся бы.
  @Max(MINUTES_IN_DAY)
  endMinute: number;

  @IsIn(PURPOSES, { message: 'Непонятно, чем занят стол' })
  purpose: ClosurePurpose;

  /**
   * Тренер занятия. Согласованность с назначением проверяется отдельно
   * (`slotViolations`): здесь видно только само поле, а правило связывает его
   * с purpose.
   */
  @IsOptional()
  @ValidateIfNotNull()
  @IsString()
  @MaxLength(64)
  coachId: string | null;

  /** Клиент, за которым закреплено время. Согласованность — там же. */
  @IsOptional()
  @ValidateIfNotNull()
  @IsString()
  @MaxLength(64)
  clientId: string | null;
}

export class ClosureRuleDto extends ClosureSlotDto implements ClosureRuleDraft {
  /** ISO-8601: 1 — понедельник, 7 — воскресенье. Ноль запрещён намеренно. */
  @IsInt()
  @Min(1, { message: 'День недели: 1 — понедельник, 7 — воскресенье' })
  @Max(7, { message: 'День недели: 1 — понедельник, 7 — воскресенье' })
  weekday: Weekday;
}

export class DayClosureDto extends ClosureSlotDto implements DayClosureDraft {}

/**
 * Потолок в тысячу окон — не паранойя: сетка на восемь столов и семь дней даёт
 * от силы несколько сотен, а запрос заметно больше означает ошибку на клиенте.
 */
const MAX_SLOTS = 1000;

export class ReplaceTemplateDto implements ReplaceTemplateRequest {
  @IsArray()
  @ArrayMaxSize(MAX_SLOTS, { message: 'Слишком много окон в расписании' })
  @ValidateNested({ each: true })
  @Type(() => ClosureRuleDto)
  rules: ClosureRuleDto[];
}

export class ReplaceDayDto implements ReplaceDayRequest {
  @IsArray()
  @ArrayMaxSize(MAX_SLOTS, { message: 'Слишком много окон в расписании' })
  @ValidateNested({ each: true })
  @Type(() => DayClosureDto)
  closures: DayClosureDto[];
}

/**
 * Пропуск проверок, когда значение — явный null.
 *
 * `@IsOptional()` пропускает и null, и undefined, но следующие за ним
 * проверки всё равно применились бы к числу; здесь null проходит насквозь как
 * осмысленное «не задано» — так стираются цены робота при выключении опции.
 */
function ValidateIfNotNull(): PropertyDecorator {
  return ValidateIf((_object: unknown, value: unknown) => value !== null);
}
