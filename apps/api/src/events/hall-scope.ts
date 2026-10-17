import type { Prisma } from '@yenisey/database';

/**
 * Мероприятия в залах страницы клуба (решение владельца от 25.09.2026):
 * мероприятие — в зале, если стоит в его расписании; без окна в сетке — там,
 * где идёт его вид (пусто — во всех залах).
 *
 * Одно правило на список «Предстоящих» и на «Ближайшее» у вида: разойдись
 * они, карточка вида и список под ней называли бы разные проведения. И на
 * «мероприятий на неделе» в карточке зала (17.10.2026) — по той же причине.
 */
export function hallScope(value: string | undefined): {
  training: Prisma.TrainingSessionWhereInput;
  tournament: Prisma.TournamentWhereInput;
} {
  const halls = value ? value.split(',').filter(Boolean) : null;

  if (!halls) {
    return { training: {}, tournament: {} };
  }

  const typeInHalls = { OR: [{ halls: { none: {} } }, { halls: { some: { hallId: { in: halls } } } }] };
  const placedInHalls = { some: { table: { hallId: { in: halls } } } };

  return {
    training: { OR: [{ dayClosures: placedInHalls }, { dayClosures: { none: {} }, trainingType: typeInHalls }] },
    tournament: { OR: [{ dayClosures: placedInHalls }, { dayClosures: { none: {} }, tournamentType: typeInHalls }] },
  };
}
