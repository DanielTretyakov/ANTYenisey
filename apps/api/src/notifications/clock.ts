import type { Prisma } from '@yenisey/database';
import { instantAt, localParts } from '../club/closures';
import type { PrismaService } from '../prisma/prisma.service';
import type { LocalClock } from './notification-rules';

type Db = Prisma.TransactionClient | PrismaService;

/** Пояс, если у клуба ещё нет ни одного зала: первый клуб платформы — в Красноярске. */
export const FALLBACK_TIMEZONE = 'Asia/Krasnoyarsk';

/** Часы пояса — для правил из notification-rules.ts. */
export function zoneClock(timezone: string): LocalClock {
  return {
    local: (instant) => localParts(instant, timezone),
    instant: (date, minute) => instantAt(date, minute, timezone),
  };
}

/**
 * Пояс клуба — пояс его старшего зала. Своего пояса у клуба нет: он свойство
 * зала (CLAUDE.md), а сообщениям о клубе целиком — утренним, о новом человеке
 * — нужен какой-то один.
 */
export async function clubTimezone(db: Db, tenantId: string): Promise<string> {
  const hall = await db.hall.findFirst({ where: { tenantId }, select: { timezone: true }, orderBy: { createdAt: 'asc' } });

  return hall?.timezone ?? FALLBACK_TIMEZONE;
}
