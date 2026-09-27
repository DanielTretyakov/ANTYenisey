import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import type { Gender, RatingPeriod } from '@yenisey/types';

export class RatingQueryDto {
  @IsOptional()
  @IsIn(['month', 'year', 'all'], { message: 'Период — month, year или all' })
  period?: RatingPeriod;

  @IsOptional()
  @IsIn(['MALE', 'FEMALE'], { message: 'Пол — MALE или FEMALE' })
  gender?: Gender;
}

export class RatingVisibilityDto {
  @IsBoolean()
  hidden: boolean;
}
