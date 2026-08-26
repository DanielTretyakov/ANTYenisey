import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { RefreshRequest } from '@yenisey/types';

export class RefreshDto implements RefreshRequest {
  /**
   * Необязателен: браузер присылает токен в httpOnly-куке и тело оставляет
   * пустым. Поле нужно клиентам без кук — мобильному приложению.
   */
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  refreshToken?: string;
}
