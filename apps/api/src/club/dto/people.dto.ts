import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { ClubPeopleQuery, Role } from '@yenisey/types';

const ROLES: Role[] = ['CLIENT', 'ADMIN', 'COACH', 'OWNER'];

/**
 * Фильтр списка людей клуба.
 *
 * Приходит строкой запроса, поэтому числа надо приводить явно: `?limit=50`
 * попадает сюда как «50», и без Type(() => Number) проверка целого провалится
 * на строке.
 */
export class ClubPeopleQueryDto implements ClubPeopleQuery {
  @IsOptional()
  @IsIn(ROLES, { message: 'Неизвестная роль' })
  role?: Role;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  /**
   * Точечная выборка: `?ids=a,b,c`.
   *
   * В строке запроса массивов нет, поэтому приходит запятыми и разбирается
   * здесь же. Потолок тот же, что у страницы: список идентификаторов длиной в
   * тысячу — это уже не точечная выборка.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.split(',').map((id) => id.trim()).filter(Boolean).slice(0, 200)
      : value,
  )
  @IsArray()
  @IsString({ each: true })
  ids?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  // Потолок страницы: список неограничен, и запрос «отдай всё» на клубе с
  // тысячами клиентов положил бы и базу, и браузер.
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
