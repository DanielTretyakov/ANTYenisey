/**
 * Склейка ФИО. Вынесена из AuthService, чтобы её можно было проверить тестом
 * без поднятия контейнера внедрения зависимостей Nest.
 */

export interface NameParts {
  lastName: string;
  firstName: string;
  middleName: string;
}

/**
 * Собирает три поля формы в одну строку ClientProfile.fullName в том порядке,
 * в каком ФИО читают в России: фамилия, имя, отчество.
 *
 * Части приходят уже очищенными от лишних пробелов (см. @Transform в
 * RegisterDto), но склейка страхуется сама: одна строка в базе с двойным
 * пробелом внутри сломала бы поиск администратора по клиентской базе.
 */
export function joinFullName(parts: NameParts): string {
  return [parts.lastName, parts.firstName, parts.middleName]
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join(' ');
}
