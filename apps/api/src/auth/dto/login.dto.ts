import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import type { LoginRequest } from '@yenisey/types';

export class LoginDto implements LoginRequest {
  @IsString()
  @Matches(/^[a-z0-9-]{2,64}$/)
  tenantSlug: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @MaxLength(128)
  password: string;
}
