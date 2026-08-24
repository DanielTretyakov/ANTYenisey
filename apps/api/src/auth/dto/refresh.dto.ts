import { IsString, MaxLength, MinLength } from 'class-validator';
import type { RefreshRequest } from '@yenisey/types';

export class RefreshDto implements RefreshRequest {
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  refreshToken: string;
}
