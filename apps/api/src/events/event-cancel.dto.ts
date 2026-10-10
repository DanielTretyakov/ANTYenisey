import { IsBoolean, IsString, MaxLength } from 'class-validator';
import type { EventCancelRequest } from '@yenisey/types';

/**
 * Отмена занятия или турнира клубом. Длина причины проверяется правилом
 * `cancelProblem` по обрезанной строке — здесь только потолок от мусора.
 */
export class EventCancelDto implements EventCancelRequest {
  @IsString()
  @MaxLength(2000)
  reason!: string;

  @IsBoolean()
  freeTables!: boolean;
}
