import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import type { RegisterRequest } from '@yenisey/types';

/**
 * Допустимые символы в частях ФИО: буквы (кириллица и латиница), дефис,
 * апостроф и пробел. Пробел нужен для двойных фамилий вида «Салтыков Щедрин»,
 * апостроф — для «О'Коннор», дефис — для «Римский-Корсаков». Цифры и
 * служебные символы исключены: это поле попадает в обращение к человеку и в
 * поиск администратора по клиентской базе.
 */
const NAME_PATTERN = /^[А-Яа-яЁёA-Za-z][А-Яа-яЁёA-Za-z' -]*[А-Яа-яЁёA-Za-z]$/;

/** Схлопывает двойные пробелы и убирает края — «  Иван  » превращается в «Иван». */
const trimName = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export class RegisterDto implements RegisterRequest {
  @IsString()
  @Matches(/^[a-z0-9-]{2,64}$/, {
    message: 'tenantSlug: только строчные латинские буквы, цифры и дефис',
  })
  tenantSlug: string;

  // Приводим к нижнему регистру до валидации и до запроса в базу: иначе
  // Ivan@club.ru и ivan@club.ru пройдут @@unique([tenantId, email]) как
  // разные адреса и станут двумя учётками одного человека.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'email: некорректный адрес' })
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(8, { message: 'password: минимум 8 символов' })
  // Верхняя граница — не каприз: argon2 хеширует вход целиком, и мегабайтный
  // «пароль» превращает форму входа в DoS-вектор.
  @MaxLength(128)
  password: string;

  // Три части ФИО обязательны и проверяются здесь, а не только в браузере:
  // форму можно обойти запросом напрямую в API.
  @Transform(trimName)
  @IsString()
  @MinLength(2, { message: 'lastName: фамилия не короче 2 символов' })
  @MaxLength(100, { message: 'lastName: фамилия не длиннее 100 символов' })
  @Matches(NAME_PATTERN, { message: 'lastName: в фамилии допустимы только буквы, дефис и апостроф' })
  lastName: string;

  @Transform(trimName)
  @IsString()
  @MinLength(2, { message: 'firstName: имя не короче 2 символов' })
  @MaxLength(100, { message: 'firstName: имя не длиннее 100 символов' })
  @Matches(NAME_PATTERN, { message: 'firstName: в имени допустимы только буквы, дефис и апостроф' })
  firstName: string;

  @Transform(trimName)
  @IsString()
  @MinLength(2, { message: 'middleName: отчество не короче 2 символов' })
  @MaxLength(100, { message: 'middleName: отчество не длиннее 100 символов' })
  @Matches(NAME_PATTERN, {
    message: 'middleName: в отчестве допустимы только буквы, дефис и апостроф',
  })
  middleName: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/[\s()-]/g, '') : value,
  )
  @Matches(/^\+7\d{10}$/, {
    message: 'phone: ожидается формат +79991234567',
  })
  phone: string;
}
