import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';
import type { ClubCoachListRequest } from '@yenisey/types';

/** Тренерский состав на странице клуба: идентификаторы в порядке показа. */
export class ClubCoachListDto implements ClubCoachListRequest {
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  coachIds: string[] = [];
}
