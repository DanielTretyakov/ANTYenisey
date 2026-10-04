import type { FeedEvent } from '@yenisey/types';
import type { PrismaService } from '../prisma/prisma.service';
import { TRAINING_EVENT_SELECT, trainingEvent } from './event-view';

/** Клуб строки: ровно то, чем назвать, открыть и покрасить. */
const CLUB_SELECT = { select: { slug: true, name: true, accentColor: true } } as const;

/**
 * Ближайшие занятия тренеров по всем их клубам — для «Ближайших занятий» на
 * странице тренера и «Моих тренеров» на стартовой (решение от 02.10.2026).
 *
 * Строка собирается тем же `trainingEvent`, что открытый список клуба:
 * окно мероприятия одно на всех, и разойтись им нельзя. Тренер — учётка
 * (`TrainingSession.coachId` и есть её id), клубов у него может быть
 * несколько. Занятия тренера, отключённого в клубе, не показываются: его
 * страница этот клуб уже не называет.
 */
export async function upcomingCoachSessions(
  prisma: PrismaService,
  coachIds: string[],
  viewerId: string | null,
  take: number,
): Promise<FeedEvent[]> {
  if (coachIds.length === 0) {
    return [];
  }

  const rows = await prisma.trainingSession.findMany({
    where: {
      coachId: { in: coachIds },
      startsAt: { gte: new Date() },
      coach: { membership: { deactivatedAt: null } },
    },
    select: { ...TRAINING_EVENT_SELECT, coachId: true, tenant: CLUB_SELECT },
    orderBy: { startsAt: 'asc' },
    take,
  });

  return rows.map((row) => ({ ...trainingEvent(row, viewerId), club: row.tenant }));
}

/**
 * То же, но первое занятие каждого тренера: `Map` тренер → занятие. Запрос
 * на тренера, а не общая выборка: тренер с плотным расписанием занял бы её
 * целиком, и у остальных «ближайшего» не нашлось бы.
 */
export async function nextSessionPerCoach(
  prisma: PrismaService,
  coachIds: string[],
  viewerId: string | null,
): Promise<Map<string, FeedEvent>> {
  const found = new Map<string, FeedEvent>();

  await Promise.all(
    coachIds.map(async (coachId) => {
      const [first] = await upcomingCoachSessions(prisma, [coachId], viewerId, 1);

      if (first) {
        found.set(coachId, first);
      }
    }),
  );

  return found;
}
