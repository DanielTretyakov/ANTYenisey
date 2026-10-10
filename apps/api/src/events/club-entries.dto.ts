import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { ClubEnrollRequest, ClubEntryCancelRequest, EventKind } from '@yenisey/types';

const KINDS: EventKind[] = ['TRAINING', 'TOURNAMENT'];

/** Клуб записывает человека на занятие или турнир. */
export class ClubEnrollDto implements ClubEnrollRequest {
  @IsIn(KINDS)
  kind!: EventKind;

  @IsString()
  @MaxLength(64)
  eventId!: string;

  @IsString()
  @MaxLength(64)
  clientId!: string;
}

/** Клуб отменяет запись человека — по правилам отмены или без списания. */
export class ClubEntryCancelDto implements ClubEntryCancelRequest {
  @IsIn(KINDS)
  kind!: EventKind;

  @IsString()
  @MaxLength(64)
  entryId!: string;

  @IsOptional()
  @IsBoolean()
  waiveCharge?: boolean;
}
