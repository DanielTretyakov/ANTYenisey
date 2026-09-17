import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import type { AttachChildRequest, ChildPasswordRequest } from '@yenisey/types';

/** Заявка на закрепление существующей учётки — по её почте. */
export class AttachChildDto implements AttachChildRequest {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Почта ребёнка указывается целиком' })
  @MaxLength(254)
  email: string;
}

/** Новый пароль ребёнку. Те же границы, что при регистрации (`AccountDto`). */
export class ChildPasswordDto implements ChildPasswordRequest {
  @IsString()
  @MinLength(8, { message: 'Пароль — не короче 8 символов' })
  @MaxLength(128)
  password: string;
}
