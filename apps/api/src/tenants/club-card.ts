import type { Prisma } from '@yenisey/database';
import type { ClubCard } from '@yenisey/types';
import { readWorkingHours } from '@yenisey/types';

/**
 * Карточка клуба в выдаче поиска и в «Моих клубах» — одна сборка на оба
 * места: до 12.10.2026 их было две одинаковые, и новое поле легко ушло бы
 * только в одну.
 *
 * Сверх названия и городов карточка отвечает на вопросы посетителя до
 * перехода (решение владельца от 12.10.2026): почём стол и открыто ли сейчас.
 * Цена — те же поля зала, что считает бронь; «открыто» считает веб по часам
 * и поясу залов — оно зависит от минуты, а не от ответа. «Ближайшее
 * мероприятие» в карточке было до 17.10.2026 — снято решением владельца.
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
    orderBy: { createdAt: 'asc' },
  },
} as const satisfies Prisma.TenantSelect;

export type CardRow = Prisma.TenantGetPayload<{ select: typeof CARD_SELECT }>;

export function toCard(row: CardRow): ClubCard {
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
  };
}
