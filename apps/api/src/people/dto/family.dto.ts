import { IsString, MaxLength, MinLength } from 'class-validator';
import type { AttachGuardianRequest, RevokeGuardianshipRequest } from '@yenisey/types';

export class AttachGuardianDto implements AttachGuardianRequest {
  @IsString()
  @MaxLength(64)
  guardianId: string;
}

/** Причину сервис ещё и срезает: из одних пробелов она не состоит. */
export class RevokeGuardianshipDto implements RevokeGuardianshipRequest {
  @IsString()
  @MinLength(1, { message: 'Объясните, почему закрепление снимает клуб' })
  @MaxLength(500, { message: 'Причина — не длиннее 500 символов' })
  reason: string;
}
