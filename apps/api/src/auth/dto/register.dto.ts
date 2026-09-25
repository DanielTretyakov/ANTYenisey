import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import type { Gender, RegisterRequest } from '@yenisey/types';

const GENDERS: Gender[] = ['MALE', 'FEMALE'];

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

/**
 * ФИО и телефон — то, что человек правит о себе сам (решение владельца от
 * 25.09.2026). Базовый класс и регистрации, и правки профиля: вторая копия
 * правил имени и телефона разошлась бы с первой на первой же правке.
 */
export class PersonDto {
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

  /**
   * Пол — ради рисованной заглушки вместо фотографии (решение владельца от
   * 25.09.2026). Обязателен и в регистрации, и в правке личных данных: у
   * учёток, заведённых раньше, он пуст, и правка его и добавляет.
   */
  @IsIn(GENDERS, { message: 'gender: укажите пол — MALE или FEMALE' })
  gender: Gender;
}

/**
 * Данные учётки: кто человек и чем он входит.
 *
 * Отдельно от регистрации, потому что учётку заводит не только сам человек:
 * родитель заводит её ребёнку, а администратор — ребёнку родителя у стойки.
 * Правила имени, почты, пароля и телефона у всех одни, и вторая копия
 * разошлась бы с первой на первой же правке.
 */
export class AccountDto extends PersonDto implements Omit<RegisterRequest, 'tenantSlug'> {
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

  /**
   * Дата рождения «2001-05-17». Разумность даты проверяет `parseBirthDate` в
   * сервисе: границы «не в будущем» и «не полтора века назад» считаются от
   * текущего дня, а декораторы такого не умеют.
   */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'birthDate: ожидается дата в виде 2001-05-17',
  })
  birthDate: string;
}

export class RegisterDto extends AccountDto implements RegisterRequest {
  /**
   * Код клуба — необязательный: аккаунт заводится на платформе. Когда
   * он всё же передан, человек пришёл со страницы клуба и сразу становится
   * его клиентом.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{2,64}$/, {
    message: 'tenantSlug: только строчные латинские буквы, цифры и дефис',
  })
  tenantSlug?: string;
}
