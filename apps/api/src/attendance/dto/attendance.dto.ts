import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type {
  AttendanceKind,
  AttendanceMarkStatus,
  MarkAttendanceBatchRequest,
  MarkAttendanceRequest,
  RecordVisitRequest,
} from '@yenisey/types';
import { MAX_BATCH } from '../attendance.service';

const MARKS: AttendanceMarkStatus[] = ['ATTENDED', 'NO_SHOW'];
const KINDS: AttendanceKind[] = ['TABLE', 'TRAINING', 'TOURNAMENT'];

export class MarkAttendanceDto implements MarkAttendanceRequest {
  @IsIn(MARKS, { message: 'Отметка — «пришёл» или «не пришёл»' })
  status: AttendanceMarkStatus;

  /**
   * Причина исправления или прощения. Обязательность проверяют правила: она
   * зависит от того, что уже стоит у записи, а здесь этого не видно.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Причина — не длиннее 500 символов' })
  reason?: string;

  @IsOptional()
  @IsBoolean()
  waiveCharge?: boolean;
}

export class BatchMarkItemDto extends MarkAttendanceDto {
  @IsIn(KINDS, { message: 'Неизвестный вид записи' })
  kind: AttendanceKind;

  @IsString()
  @MaxLength(64)
  entryId: string;
}

export class MarkAttendanceBatchDto implements MarkAttendanceBatchRequest {
  @IsArray()
  @ArrayMinSize(1, { message: 'Отмечать некого' })
  @ArrayMaxSize(MAX_BATCH, { message: `Не больше ${MAX_BATCH} отметок за раз` })
  @ValidateNested({ each: true })
  @Type(() => BatchMarkItemDto)
  marks: BatchMarkItemDto[];
}

export class RecordVisitDto implements RecordVisitRequest {
  @IsString()
  @MaxLength(64)
  clientId: string;

  @IsISO8601({ strict: true }, { message: 'Время визита указывается моментом в ISO-8601' })
  visitedAt: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  coachId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Комментарий — не длиннее 500 символов' })
  note?: string;
}
