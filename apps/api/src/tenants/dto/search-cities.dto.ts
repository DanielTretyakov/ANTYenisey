import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { CitySearchQuery } from '@yenisey/types';

/**
 * Поиск города для подсказок: начало названия и сколько подсказок отдать.
 * Пустой запрос — самые крупные города: подсказка у пустого поля должна
 * что-то предлагать, а не молчать.
 */
export class SearchCitiesDto implements CitySearchQuery {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  query?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
