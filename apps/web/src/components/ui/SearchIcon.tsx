/**
 * Лупа в поле поиска — слева, поверх поля с отступом `pl-12`. Общая для
 * названия клуба, города и региона на стартовой (решение владельца от
 * 30.09.2026: лупа у всех полей поиска).
 */
export function SearchIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-text-subtle"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="6" />
      <path d="m13.5 13.5 3.5 3.5" />
    </svg>
  );
}
