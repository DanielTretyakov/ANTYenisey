import { CLUB_SLUG_PATTERN } from '@yenisey/types';

/** Зал в том объёме, в каком его судит открытие клуба. */
export interface OpeningHall {
  name: string;
  /** Адрес выбран из справочника — у зала без него карточка пуста. */
  hasAddress: boolean;
  tables: number;
}

/**
 * Чего не хватает, чтобы открыть клуб (решения владельца от 11.10.2026).
 * Открыть можно, когда готов хотя бы один зал: с адресом и столами, — иначе
 * посетитель найдёт клуб, в котором некуда прийти и нечего забронировать.
 * Пустой список — открывать можно.
 */
export function openingProblems(halls: readonly OpeningHall[]): string[] {
  if (halls.length === 0) {
    return ['Заведите хотя бы один зал — в «Настройках»'];
  }

  if (halls.some((hall) => hall.hasAddress && hall.tables > 0)) {
    return [];
  }

  return halls.flatMap((hall) => [
    ...(hall.hasAddress ? [] : [`У зала «${hall.name}» нет адреса`]),
    ...(hall.tables > 0 ? [] : [`В зале «${hall.name}» нет столов`]),
  ]);
}

/**
 * Код клуба для адреса /clubs/:slug — то же правило, что CHECK
 * `Tenant_slug_format`: сообщение человеку вместо пятисотки от базы.
 */
export function slugProblem(slug: string): string | null {
  if (slug.length < 3 || slug.length > 40) {
    return 'Код клуба — от 3 до 40 знаков';
  }

  return CLUB_SLUG_PATTERN.test(slug) ? null : 'Код клуба — строчная латиница и цифры через дефис: «eniseyy», «stolby-2»';
}
