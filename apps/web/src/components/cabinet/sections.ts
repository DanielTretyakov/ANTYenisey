/**
 * Разделы редактора кабинета — пункты меню.
 *
 * Пять, а не девять (решение владельца от 25.09.2026): профиль игрока —
 * одной страницей из карточек, как его видят другие; клубы и семья — рядом.
 *
 * `perPerson` — раздел идёт за выбранным ребёнком (`?for=`): профиль игрока и
 * абонементы родитель ведёт за ребёнка. Остальное — всегда своё: личные
 * данные, клубы, семья и уведомления принадлежат учётке, а не тому, за кого
 * действуют.
 */
export const CABINET_SECTIONS = [
  { id: 'profile', label: 'Личные данные', perPerson: false },
  { id: 'player', label: 'Профиль игрока', perPerson: true },
  { id: 'subscriptions', label: 'Абонементы', perPerson: true },
  { id: 'clubs', label: 'Клубы и семья', perPerson: false },
  { id: 'notifications', label: 'Уведомления', perPerson: false },
] as const;

export type CabinetSection = (typeof CABINET_SECTIONS)[number]['id'];

/** Куда ведёт `/cabinet/edit` без раздела — личные данные, они наверху. */
export const FIRST_SECTION: CabinetSection = 'profile';

export function sectionsFor(): typeof CABINET_SECTIONS {
  return CABINET_SECTIONS;
}

export function isSection(value: string): value is CabinetSection {
  return CABINET_SECTIONS.some((section) => section.id === value);
}

/** Адрес раздела: у разделов ребёнка — с `?for=`, у своих — без. */
export function sectionHref(id: CabinetSection, forPerson: string | null): string {
  const perPerson = CABINET_SECTIONS.find((section) => section.id === id)?.perPerson ?? false;

  return perPerson && forPerson ? `/cabinet/edit/${id}?for=${forPerson}` : `/cabinet/edit/${id}`;
}
