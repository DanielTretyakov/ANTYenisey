/**
 * Только поля, которые человек поменял, — относительно того, что форма
 * показала при загрузке или последнем сохранении.
 *
 * Настройки клуба вступают в силу в полночь (решение владельца от
 * 26.09.2026), а сервер ставит в очередь каждое поле, отличное от текущего в
 * базе. Форма после сохранения показывает уже новое значение — и, пришли она
 * его снова вместе с другой правкой, сервер поставил бы его в очередь второй
 * раз. Поэтому форма шлёт только своё изменённое.
 */
export function changedOnly<T extends object>(next: T, before: object): Partial<T> {
  const baseline = before as Record<string, unknown>;

  return Object.fromEntries(
    Object.entries(next).filter(([key, value]) => JSON.stringify(value ?? null) !== JSON.stringify(baseline[key] ?? null)),
  ) as Partial<T>;
}
