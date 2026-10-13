import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import type {
  ChangePasswordRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  UpdateProfileRequest,
  VerifyEmailRequest,
} from '@yenisey/types';
import { PersonDto } from './register.dto';

/**
 * Правка своих данных: ФИО и телефон. Почты и даты рождения здесь нет
 * намеренно (решение владельца от 25.09.2026): почта — логин и адрес писем
 * (её подтверждают письмом, 12.10.2026); дата рождения решает правила до 14 лет, и
 * правка её самим ребёнком вывела бы его из-под опеки.
 */
export class UpdateProfileDto extends PersonDto implements UpdateProfileRequest {}

export class VerifyEmailDto implements VerifyEmailRequest {
  @IsString()
  @MaxLength(128)
  token: string;
}

export class ForgotPasswordDto implements ForgotPasswordRequest {
  @IsEmail({}, { message: 'email: адрес вида name@example.ru' })
  @MaxLength(254)
  email: string;
}

export class ResetPasswordDto implements ResetPasswordRequest {
  @IsString()
  @MaxLength(128)
  token: string;

  @IsString()
  @MinLength(8, { message: 'password: минимум 8 символов' })
  @MaxLength(128)
  password: string;
}

export class ChangePasswordDto implements ChangePasswordRequest {
  @IsString()
  @MaxLength(128)
  currentPassword: string;

  @IsString()
  @MinLength(8, { message: 'newPassword: минимум 8 символов' })
  @MaxLength(128)
  newPassword: string;
}
