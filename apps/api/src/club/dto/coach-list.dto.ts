import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
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

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CoachHallsDto)
  coachHalls?: CoachHallsDto[];
}

export class CoachHallsDto {
  @IsString()
  @MaxLength(64)
  coachId: string;

  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  hallIds: string[];
}
