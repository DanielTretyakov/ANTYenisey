import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { StaffPreferences } from '@yenisey/types';

/** Приоритетный зал. `null` — снять выбор, первым снова станет первый по имени. */
export class StaffPreferencesDto implements StaffPreferences {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  preferredHallId: string | null = null;
}
