import { IsString, MaxLength, MinLength } from 'class-validator';
import type { ChangePasswordRequest, UpdateProfileRequest } from '@yenisey/types';
import { PersonDto } from './register.dto';

/**
 * Правка своих данных: ФИО и телефон. Почты и даты рождения здесь нет
 * намеренно (решение владельца от 25.09.2026): почта — логин, а писем
 * подтверждения в продукте нет; дата рождения решает правила до 14 лет, и
 * правка её самим ребёнком вывела бы его из-под опеки.
 */
export class UpdateProfileDto extends PersonDto implements UpdateProfileRequest {}

export class ChangePasswordDto implements ChangePasswordRequest {
  @IsString()
  @MaxLength(128)
  currentPassword: string;

  @IsString()
  @MinLength(8, { message: 'newPassword: минимум 8 символов' })
  @MaxLength(128)
  newPassword: string;
}
