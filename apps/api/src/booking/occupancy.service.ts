import { BadRequestException, Injectable } from '@nestjs/common';
import { BookingStatus } from '@yenisey/database';
import type { BusyInterval, ClosureSlot, Weekday } from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';
import { instantAt, localParts, slotsForDate, weekdayOf } from '../club/closures';
import { CLOSE_MINUTE } from './availability';

/**
 * Чем занят зал на конкретную дату.
 *
 * Вынесено из `BookingService`, где эта выборка была приватным методом, потому
 * что мест, задающих вопрос «что занято», стало два, и смотрят они на разное:
 *
 * - клиенту нужна плоская занятость без причин: расписание клуба — внутренняя
 *   кухня, а для выбора времени достаточно знать, что стол не свободен;
 * - администратору на экране смены причина и есть суть: он смотрит на зал,
 *   чтобы ответить на звонок.
 *
 * Общее у них — разбор расписания: шаблон недели против правки даты. Правило
 * «правленый день ЗАМЕНЯЕТ шаблон целиком» живёт в `slotsForDate`, и повторять
 * его во втором месте нельзя — движок бронирования и рабочее место разошлись
 * бы в понимании расписания, а заметили бы это по чужой брони под тренировкой.
 */

/** Статусы, при которых бронь занимает время. Те же, что в exclusion-констрейнте. */
export const ACTIVE_BOOKING: BookingStatus[] = [BookingStatus.BOOKED, BookingStatus.ATTENDED];

/**
 * Поля окна расписания, которых требует общий тип `ClosureSlot`.
 *
 * Движку бронирования из окна нужны только границы, но `slotsForDate` — та
 * самая функция, которая решает, заменяет ли правленая дата шаблон, — работает
 * с окном целиком. Повторять её правило здесь ради экономии пяти колонок
 * значило бы завести второе понимание расписания.
 */
const SLOT_SELECT = {
  id: true,
  tableId: true,
  startMinute: true,
  endMinute: true,
  purpose: true,
  coachId: true,
  trainingTypeId: true,
} as const;

@Injectable()
export class OccupancyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Окна расписания зала на дату — с назначением, тренером и арендатором.
   *
   * Это исходная, неупрощённая форма: кто именно и подо что занял стол.
   * Клиентская сетка сплющивает её до промежутков, рабочее место показывает
   * как есть.
   */
  async slotsOn(tenantId: string, hallId: string, date: string): Promise<ClosureSlot[]> {
    assertDateFormat(date);

    const [template, day] = await Promise.all([
      this.prisma.tableClosureRule.findMany({
        where: { tenantId, table: { hallId } },
        select: { ...SLOT_SELECT, weekday: true, tournamentTypeId: true },
      }),
      this.prisma.hallDaySchedule.findFirst({
        where: { tenantId, hallId, date: parseDate(date) },
        select: {
          closures: { select: { ...SLOT_SELECT, tournamentId: true, trainingSessionId: true } },
        },
      }),
    ]);

    return slotsForDate(
      template.map((rule) => ({
        ...rule,
        weekday: rule.weekday as Weekday,
        tournamentId: null,
        trainingSessionId: null,
      })),
      day
        ? {
            customised: true,
            closures: day.closures.map((closure) => ({ ...closure, tournamentTypeId: null })),
          }
        : null,
      weekdayOf(date),
    );
  }

  /**
   * Занятое время столов на дату, в минутах от местной полуночи.
   *
   * Два источника: расписание зала и уже заведённые брони. Клиенту они
   * приходят одним списком — различать их ему незачем.
   */
  async busyByTable(
    tenantId: string,
    hallId: string,
    date: string,
    timezone: string,
    tableIds: string[],
  ): Promise<Map<string, BusyInterval[]>> {
    const busy = new Map<string, BusyInterval[]>();

    const add = (tableId: string, interval: BusyInterval): void => {
      const list = busy.get(tableId) ?? [];
      list.push(interval);
      busy.set(tableId, list);
    };

    for (const slot of await this.slotsOn(tenantId, hallId, date)) {
      add(slot.tableId, { startMinute: slot.startMinute, endMinute: slot.endMinute });
    }

    for (const booking of await this.bookingsOn(tenantId, date, timezone, tableIds)) {
      add(booking.tableId, {
        startMinute: localParts(booking.startsAt, timezone).minutes,
        // Конец ровно в полночь местные сутки отдают как 1440, а не как 0:
        // иначе промежуток вывернулся бы и перестал считаться занятым.
        endMinute: localParts(booking.endsAt, timezone).minutes || CLOSE_MINUTE,
      });
    }

    return busy;
  }

  /**
   * Активные брони столов, попадающие в местные сутки даты.
   *
   * Полуоткрытый промежуток суток: бронь, кончающаяся ровно в местную полночь,
   * принадлежит уходящему дню, а не наступающему.
   */
  bookingsOn(
    tenantId: string,
    date: string,
    timezone: string,
    tableIds: string[],
  ): Promise<{ tableId: string; startsAt: Date; endsAt: Date }[]> {
    return this.prisma.tableBooking.findMany({
      where: {
        tenantId,
        tableId: { in: tableIds },
        status: { in: ACTIVE_BOOKING },
        startsAt: { lt: instantAt(date, CLOSE_MINUTE, timezone) },
        endsAt: { gt: instantAt(date, 0, timezone) },
      },
      select: { tableId: true, startsAt: true, endsAt: true },
    });
  }
}

export function assertDateFormat(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new BadRequestException('Дата указывается в виде 2026-03-12');
  }
}

/** «2026-03-12» → полночь UTC этой даты: колонка типа DATE часов не хранит. */
export function parseDate(date: string): Date {
  assertDateFormat(date);

  return new Date(`${date}T00:00:00Z`);
}
