import type { Prisma } from '@yenisey/database';
import type { ClubCard, ClubCardEvent } from '@yenisey/types';
import { readWorkingHours } from '@yenisey/types';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Карточка клуба в выдаче поиска и в «Моих клубах» — одна сборка на оба
 * места: до 12.10.2026 их было две одинаковые, и новое поле легко ушло бы
 * только в одну.
 *
 * Сверх названия и городов карточка отвечает на вопросы посетителя до
 * перехода (решение владельца от 12.10.2026): почём стол, открыто ли сейчас
 * и что ближайшее. Цена — те же поля зала, что считает бронь; «открыто»
 * считает веб по часам и поясу залов — оно зависит от минуты, а не от ответа.
 */
export const CARD_SELECT = {
  id: true,
  slug: true,
  name: true,
  logoFileId: true,
  accentColor: true,
  city: { select: { name: true } },
  halls: {
    select: {
      city: { select: { name: true } },
      tableHourPrice: true,
      workingHours: true,
      timezone: true,
    },
    // Старший зал первым: его пояс — пояс ближайшего мероприятия.
    orderBy: { createdAt: 'asc' },
  },
} as const satisfies Prisma.TenantSelect;

export type CardRow = Prisma.TenantGetPayload<{ select: typeof CARD_SELECT }>;

export function toCard(row: CardRow, next: ClubCardEvent | null = null): ClubCard {
  const city = row.city?.name ?? null;
  const prices = row.halls.map((hall) => hall.tableHourPrice);

  return {
    slug: row.slug,
    name: row.name,
    logoFileId: row.logoFileId,
    accentColor: row.accentColor,
    city,
    otherCities: [
      ...new Set(
        row.halls
          .map((hall) => hall.city?.name)
          .filter((name): name is string => name !== undefined && name !== null && name !== city),
      ),
    ].sort(),
    hallCount: row.halls.length,
    fromPrice: prices.length > 0 ? Math.min(...prices) : null,
    hours: row.halls.map((hall) => ({ workingHours: readWorkingHours(hall.workingHours), timezone: hall.timezone })),
    next,
  };
}

/**
 * Ближайшее занятие или турнир каждого клуба — двумя запросами на всю выдачу,
 * а не по запросу на клуб. Отменённое не в счёт (как во всех «что будет»).
 * Окно — две недели: дальше расписание обычно ещё не составлено, и карточке
 * незачем звать на занятие через месяц.
 */
export async function nextEvents(
  prisma: PrismaService,
  rows: readonly CardRow[],
  now: Date,
): Promise<Map<string, ClubCardEvent>> {
  const tenantIds = rows.map((row) => row.id);
  const until = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const window = { tenantId: { in: tenantIds }, cancelledAt: null, startsAt: { gt: now, lt: until } };

  if (tenantIds.length === 0) {
    return new Map();
  }

  const [sessions, tournaments] = await Promise.all([
    prisma.trainingSession.findMany({
      where: window,
      select: { tenantId: true, startsAt: true, trainingType: { select: { name: true } } },
      orderBy: { startsAt: 'asc' },
      distinct: ['tenantId'],
    }),
    prisma.tournament.findMany({
      where: window,
      select: { tenantId: true, startsAt: true, tournamentType: { select: { name: true } } },
      orderBy: { startsAt: 'asc' },
      distinct: ['tenantId'],
    }),
  ]);

  const zoneOf = new Map(rows.map((row) => [row.id, row.halls[0]?.timezone ?? 'Asia/Krasnoyarsk']));
  const nearest = new Map<string, ClubCardEvent>();
  const offer = (tenantId: string, event: Omit<ClubCardEvent, 'timezone'>): void => {
    const current = nearest.get(tenantId);

    if (!current || event.startsAt < current.startsAt) {
      nearest.set(tenantId, { ...event, timezone: zoneOf.get(tenantId)! });
    }
  };

  for (const session of sessions) {
    offer(session.tenantId, { kind: 'TRAINING', title: session.trainingType.name, startsAt: session.startsAt.toISOString() });
  }

  for (const tournament of tournaments) {
    offer(tournament.tenantId, {
      kind: 'TOURNAMENT',
      title: tournament.tournamentType.name,
      startsAt: tournament.startsAt.toISOString(),
    });
  }

  return nearest;
}
