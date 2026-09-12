import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, Matches, MaxLength } from 'class-validator';

/**
 * Поиск человека на платформе — по ТОЧНОЙ почте или ТОЧНОМУ телефону.
 *
 * Частичного совпадения здесь нет и быть не должно: администратор ищет того,
 * кто стоит перед ним и назвал свою почту, а не листает людей чужих клубов.
 * Телефон приводится к тому же виду, что и при регистрации, — иначе
 * «+7 (999) 123-45-67» не нашёл бы «+79991234567».
 */
export class PersonLookupQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Почта указывается целиком' })
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/[\s()-]/g, '') : value,
  )
  @Matches(/^\+7\d{10}$/, { message: 'Телефон указывается целиком, в виде +79991234567' })
  phone?: string;
}
