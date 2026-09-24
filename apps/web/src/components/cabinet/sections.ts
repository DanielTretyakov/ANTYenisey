import type { PublicUser } from '@yenisey/types';
import { canBeGuardianBirthDate, isChildBirthDate } from '@/lib/family';

/**
 * Разделы редактора кабинета — пункты бокового меню (решение владельца от
 * 24.09.2026: «разбивка по блокам и бургер-меню с этими блоками»).
 *
 * `perPerson` — раздел идёт за выбранным ребёнком (`?for=`): профиль игрока и
 * абонементы родитель ведёт за ребёнка. Остальное — всегда своё: личные
 * данные, семья, клубы и уведомления принадлежат учётке, а не тому, за кого
 * действуют.
 */
export const CABINET_SECTIONS = [
  { id: 'avatar', label: 'Фото', perPerson: true },
  { id: 'equipment', label: 'Инвентарь', perPerson: true },
  { id: 'rank', label: 'Разряд', perPerson: true },
  { id: 'achievements', label: 'Достижения', perPerson: true },
  { id: 'subscriptions', label: 'Абонементы', perPerson: true },
  { id: 'family', label: 'Семья', perPerson: false },
  { id: 'clubs', label: 'Мои клубы', perPerson: false },
  { id: 'notifications', label: 'Уведомления', perPerson: false },
  { id: 'profile', label: 'Личные данные', perPerson: false },
] as const;

export type CabinetSection = (typeof CABINET_SECTIONS)[number]['id'];

export const FIRST_SECTION: CabinetSection = 'avatar';

/**
 * Разделы, которые есть у этого человека. «Семья» — у взрослого (он ведёт
 * детей) и у ребёнка младше 16 (он видит, кто его ведёт); в 16–17 лет ни
 * того ни другого нет.
 */
export function sectionsFor(user: PublicUser) {
  const family = canBeGuardianBirthDate(user.birthDate) || isChildBirthDate(user.birthDate);

  return CABINET_SECTIONS.filter((section) => section.id !== 'family' || family);
}

export function isSection(value: string): value is CabinetSection {
  return CABINET_SECTIONS.some((section) => section.id === value);
}

/** Адрес раздела: у разделов ребёнка — с `?for=`, у своих — без. */
export function sectionHref(id: CabinetSection, forPerson: string | null): string {
  const perPerson = CABINET_SECTIONS.find((section) => section.id === id)?.perPerson ?? false;

  return perPerson && forPerson ? `/cabinet/edit/${id}?for=${forPerson}` : `/cabinet/edit/${id}`;
}
