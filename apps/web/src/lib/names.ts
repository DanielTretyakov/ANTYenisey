/**
 * Сокращение ФИО до «Фамилия И.».
 *
 * Формат взят из ТЗ: в списке записавшихся на тренировку клиент видит именно
 * «Фамилия И.». Здесь он нужен по другой причине — в клетку расписания
 * шириной в сотню пикселей полное ФИО не помещается, а различать тренеров
 * надо с одного взгляда.
 */
export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return '';
  }

  const [surname, firstName] = parts;

  // Одно слово — отдаём как есть: инициал брать неоткуда, а обрезать фамилию
  // до буквы значит потерять единственное, что различает людей.
  if (!firstName) {
    return surname!;
  }

  return `${surname} ${firstName[0]!.toUpperCase()}.`;
}
