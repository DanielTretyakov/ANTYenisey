import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type {
  ClosureExceptionRequest,
  ClosureRuleDraft,
  ReplaceClosureRulesRequest,
  Weekday,
} from '@yenisey/types';
import { MINUTES_IN_DAY } from '../closures';

export class ClosureRuleDto implements ClosureRuleDraft {
  @IsString()
  @MaxLength(64)
  tableId: string;

  /** ISO-8601: 1 — понедельник, 7 — воскресенье. Ноль запрещён намеренно. */
  @IsInt()
  @Min(1, { message: 'День недели: 1 — понедельник, 7 — воскресенье' })
  @Max(7, { message: 'День недели: 1 — понедельник, 7 — воскресенье' })
  weekday: Weekday;

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
}

export class ReplaceClosureRulesDto implements ReplaceClosureRulesRequest {
  /**
   * Всё расписание разом. Потолок в тысячу строк — не паранойя: сетка на
   * восемь столов и семь дней даёт от силы несколько сотен окон, а запрос
   * заметно больше означает ошибку на клиенте, а не настоящее расписание.
   */
  @IsArray()
  @ArrayMaxSize(1000, { message: 'Слишком много окон в расписании' })
  @ValidateNested({ each: true })
  @Type(() => ClosureRuleDto)
  rules: ClosureRuleDto[];
}

export class ClosureExceptionDto implements ClosureExceptionRequest {
  @IsString()
  @MaxLength(64)
  tableId: string;

  @IsISO8601({ strict: true }, { message: 'Начало указывается моментом времени в ISO-8601' })
  startsAt: string;

  @IsISO8601({ strict: true }, { message: 'Конец указывается моментом времени в ISO-8601' })
  endsAt: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  reason?: string | null;
}
