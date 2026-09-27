import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import type { SparringTypeRequest } from '@yenisey/types';

/**
 * Тип спарринга из конструктора. Смысловые проверки (возраст «от» не больше
 * «до», чистка названия) — в `parseSparringType`, здесь только форма.
 */
export class SparringTypeDto implements SparringTypeRequest {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsInt({ message: 'Цена часа — в копейках, целым числом' })
  @Min(0)
  @Max(100_000_000)
  hourPrice: number;

  @IsOptional()
  @ValidateIf((dto: SparringTypeDto) => dto.minAge !== null)
  @IsInt({ message: 'Возраст — целым числом лет' })
  minAge?: number | null;

  @IsOptional()
  @ValidateIf((dto: SparringTypeDto) => dto.maxAge !== null)
  @IsInt({ message: 'Возраст — целым числом лет' })
  maxAge?: number | null;

  @IsOptional()
  @ValidateIf((dto: SparringTypeDto) => dto.description !== null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Поиск ученика тренером: от двух букв фамилии. */
export class StudentSearchDto {
  @IsString()
  @MinLength(2, { message: 'Наберите хотя бы две буквы' })
  @MaxLength(100)
  search: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}
