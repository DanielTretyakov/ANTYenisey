/**
 * Цвет, закреплённый за человеком в сетке расписания.
 *
 * Назначение окна и так подписано словом, а вот тренеров и арендаторов в
 * расписании десятки, и различать их по тексту в клетке высотой в 28 пикселей
 * тяжело. Цвет даёт это с одного взгляда: две тренировки подряд разного цвета
 * — это два разных тренера, и видно, не читая.
 *
 * Цвета раздаются по порядку в отсортированном списке, а не хешем от
 * идентификатора: хеш даёт коллизии, и двум тренерам смежных окон вполне может
 * достаться один цвет — ровно то, что эта затея должна была исключить.
 */
const PALETTE = [
  { cell: 'bg-emerald-600/70 hover:bg-emerald-600/85', dot: 'bg-emerald-600' },
  { cell: 'bg-sky-600/70 hover:bg-sky-600/85', dot: 'bg-sky-600' },
  { cell: 'bg-amber-600/70 hover:bg-amber-600/85', dot: 'bg-amber-600' },
  { cell: 'bg-violet-600/70 hover:bg-violet-600/85', dot: 'bg-violet-600' },
  { cell: 'bg-rose-600/70 hover:bg-rose-600/85', dot: 'bg-rose-600' },
  { cell: 'bg-teal-600/70 hover:bg-teal-600/85', dot: 'bg-teal-600' },
  { cell: 'bg-indigo-600/70 hover:bg-indigo-600/85', dot: 'bg-indigo-600' },
  { cell: 'bg-orange-600/70 hover:bg-orange-600/85', dot: 'bg-orange-600' },
  { cell: 'bg-cyan-600/70 hover:bg-cyan-600/85', dot: 'bg-cyan-600' },
  { cell: 'bg-fuchsia-600/70 hover:bg-fuchsia-600/85', dot: 'bg-fuchsia-600' },
] as const;

export interface PersonColor {
  /** Классы фона клетки. */
  cell: string;
  /** Классы кружка в легенде и в палитре. */
  dot: string;
}

/**
 * Раздача цветов по списку людей.
 *
 * Список сортируется, чтобы цвет человека не прыгал от того, в каком порядке
 * пришёл ответ сервера: перекрасившееся за ночь расписание сбивает с толку
 * сильнее, чем отсутствие цвета вовсе.
 *
 * Когда людей больше, чем цветов, палитра идёт по кругу — соседние по списку
 * всё равно различаются, а одинаковый цвет достаётся людям, отстоящим друг от
 * друга на всю палитру.
 */
export function personColors(ids: readonly string[]): Map<string, PersonColor> {
  const colors = new Map<string, PersonColor>();
  const sorted = [...new Set(ids)].sort();

  sorted.forEach((id, index) => {
    colors.set(id, PALETTE[index % PALETTE.length]!);
  });

  return colors;
}
