import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';
import type { ClubCoachListRequest } from '@yenisey/types';

/** Тренерский состав на странице клуба: порядок наверху и скрытые. */
export class ClubCoachListDto implements ClubCoachListRequest {
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  coachIds: string[] = [];

  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  hiddenIds: string[] = [];
}
