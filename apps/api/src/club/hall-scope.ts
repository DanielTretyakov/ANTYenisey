/**
 * Строгая проверка расписания зала (решение владельца от 25.09.2026): в зале
 * — только его виды мероприятий и тренеры. Правило «пусто — во всех залах»
 * живёт в `@yenisey/types` (`availableIn`): им же фильтрует страница клуба.
 *
 * Чистый модуль без относительных импортов — его гоняет `node --test`.
 */
import { availableIn } from '@yenisey/types';

/** То, на что ссылается окно расписания: тренер, вид занятия, вид турнира. */
export interface ScopedRef {
  kind: 'coach' | 'training' | 'tournament';
  id: string;
  /** Для сообщения: «Иванов И.», «Детская тренировка». */
  name: string;
  /** Залы, к которым привязан; пусто — во всех. */
  links: readonly string[];
}

export const refKey = (ref: Pick<ScopedRef, 'kind' | 'id'>): string => `${ref.kind}:${ref.id}`;

/**
 * Нарушения привязки в сохраняемом расписании зала.
 *
 * Строго — но только к тому, что правка добавляет. `alreadyInHall` — ключи
 * того, что стояло в расписании этого зала ДО правки: если вид сузили до
 * другого зала, уже заведённые окна не запирают редактирование дня, а вот
 * новое окно с чужим видом или тренером не пройдёт.
 */
export function hallScopeViolations(
  hallId: string,
  refs: readonly ScopedRef[],
  alreadyInHall: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>();
  const violations: string[] = [];

  for (const ref of refs) {
    const key = refKey(ref);

    if (seen.has(key) || alreadyInHall.has(key) || availableIn(ref.links, hallId)) {
      continue;
    }

    seen.add(key);
    violations.push(
      ref.kind === 'coach'
        ? `Тренер ${ref.name} не тренирует в этом зале — отметьте зал у тренера в настройках клуба`
        : `«${ref.name}» не проводится в этом зале — отметьте зал у вида в «Занятиях и турнирах»`,
    );
  }

  return violations;
}
