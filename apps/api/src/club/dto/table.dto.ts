import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { TableRequest } from '@yenisey/types';

export class TableDto implements TableRequest {
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
