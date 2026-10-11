import { Role, type Prisma } from '@yenisey/database';
import type { PrismaService } from '../prisma/prisma.service';
import { effectiveShift, isoWeekday, type ShiftSource } from './shift-rules';

type Db = Prisma.TransactionClient | PrismaService;

/** Зал и его местная дата. */
export interface ShiftSlot {
  hallId: string;
  date: string;
}

export interface EffectiveShift {
  adminIds: string[];
  source: ShiftSource;
}

/**
 * Кто на смене в каждом из залов-дней (решение владельца от 10.10.2026):
 * ручной день — его список, иначе шаблон недели зала. Правило — чистая
 * `effectiveShift`, здесь только выборка: одна на «Смену», запрет записи
 * администратору, «Расписание персонала» и предупреждение о дне без смены, —
 * второе чтение шаблона разошлось бы с первым молча.
 *
 * В счёт идут только действующие администраторы: человек, у которого сняли
 * роль или клуб, в шаблоне остаётся строкой, но на смене его нет.
 *
 * Ключ результата — `${hallId}:${date}`.
 */
export async function effectiveShifts(
  db: Db,
  tenantId: string,
  slots: readonly ShiftSlot[],
): Promise<Map<string, EffectiveShift>> {
  const result = new Map<string, EffectiveShift>();

  if (slots.length === 0) {
    return result;
  }

  const hallIds = [...new Set(slots.map((slot) => slot.hallId))];
  const dates = [...new Set(slots.map((slot) => slot.date))].map(dayOf);
  const active = { deactivatedAt: null, roles: { has: Role.ADMIN }, user: { deactivatedAt: null } };

  const [markers, rows, template] = await Promise.all([
    db.staffShiftDay.findMany({
      where: { tenantId, hallId: { in: hallIds }, date: { in: dates } },
      select: { hallId: true, date: true },
    }),
    db.staffShift.findMany({
      where: { tenantId, hallId: { in: hallIds }, date: { in: dates }, admin: active },
      select: { hallId: true, date: true, userId: true },
    }),
    db.staffShiftTemplate.findMany({
      where: { tenantId, hallId: { in: hallIds }, admin: active },
      select: { hallId: true, weekday: true, userId: true },
    }),
  ]);

  const manual = new Set(markers.map((row) => `${row.hallId}:${dateOf(row.date)}`));
  const byDay = group(rows, (row) => `${row.hallId}:${dateOf(row.date)}`);
  const byWeekday = group(template, (row) => `${row.hallId}:${row.weekday}`);

  for (const slot of slots) {
    const key = `${slot.hallId}:${slot.date}`;

    result.set(
      key,
      effectiveShift({
        manual: manual.has(key),
        dayAdminIds: byDay.get(key) ?? [],
        templateAdminIds: byWeekday.get(`${slot.hallId}:${isoWeekday(slot.date)}`) ?? [],
      }),
    );
  }

  return result;
}

/** «2026-09-27» → полночь UTC: колонка DATE часов не хранит. */
export function dayOf(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function dateOf(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function group<T extends { userId: string }>(rows: readonly T[], key: (row: T) => string): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const row of rows) {
    map.set(key(row), [...(map.get(key(row)) ?? []), row.userId]);
  }

  return map;
}
