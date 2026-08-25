/**
 * Склейка классов с отбрасыванием пустых значений.
 *
 * Намеренно без clsx и tailwind-merge: конфликтующих классов в компонентах не
 * появляется, потому что варианты собираются в одном месте и не смешиваются.
 * Если начнут — тогда и подключим tailwind-merge, а не заранее.
 */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}
