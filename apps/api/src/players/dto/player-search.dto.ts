import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { PlayerSearchSort } from '@yenisey/types';

/** «Найти игрока»: строка поиска (ФИО и год), порядок и страница. */
export class PlayerSearchDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;

  @IsOptional()
  @IsIn(['name', 'FNTR', 'RTTW', 'RTTF'], { message: 'sort: name, FNTR, RTTW или RTTF' })
  sort?: PlayerSearchSort;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  offset?: number;
}
