import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus } from '@yenisey/database';
import {
  BOOKING_HORIZON_DAYS,
  type BookingDay,
  type BookingQuote,
  type BusyInterval,
  type ClientBooking,
  type CreateBookingRequest,
  type Weekday,
} from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';
import { instantAt, localParts, slotsForDate } from '../club/closures';
import {
  bookingViolation,
  cancellationPercent,
  CLOSE_MINUTE,
  mergeBusy,
  OPEN_MINUTE,
  STEP_MINUTES,
} from './availability';
import { quote } from './pricing';

/** Статусы, при которых бронь занимает время. Те же, что в exclusion-констрейнте. */
const ACTIVE: BookingStatus[] = [BookingStatus.BOOKED, BookingStatus.ATTENDED];

const HALL_PRICING = {
  id: true,
  name: true,
  bookingStep: true,
  tableHourPrice: true,
  tableExtra30MinPrice: true,
  hasRobotOption: true,
  robot30MinPrice: true,
  robot60MinPrice: true,
  robotExtra30MinPrice: true,
} as const;

/**
 * Поля окна расписания, которых требует общий тип `ClosureSlot`.
 *
 * Движку бронирования из окна нужны только границы, но `slotsForDate` — та
 * самая функция, которая решает, заменяет ли правленая дата шаблон, — работает
 * с окном целиком. Повторять её правило здесь ради экономии пяти колонок
 * значило бы завести второе понимание расписания, расходящееся с профилем
 * клуба.
 */
const SLOT_SELECT = {
  id: true,
  tableId: true,
  startMinute: true,
  endMinute: true,
  purpose: true,
  coachId: true,
  clientId: true,
  trainingTypeId: true,
} as const;

const BOOKING_SELECT = {
  id: true,
  tableId: true,
  startsAt: true,
  endsAt: true,
  withRobot: true,
  priceAtBooking: true,
  status: true,
  cancelledAt: true,
  chargeRatio: true,
  table: { select: { label: true, hallId: true, hall: { select: { name: true } } } },
} as const;

interface BookingRow {
  id: string;
  tableId: string;
  startsAt: Date;
  endsAt: Date;
  withRobot: boolean;
  priceAtBooking: number;
  status: BookingStatus;
  cancelledAt: Date | null;
  chargeRatio: number | null;
  table: { label: string; hallId: string; hall: { name: string } };
}

type Tier = { minMinutesBeforeStart: number; chargePercent: number };

/**
 * Самостоятельная онлайн-аренда стола клиентом.
 *
 * Четвёртый сценарий ТЗ: клиент бронирует сам, без подтверждения
 * администратора. Здесь впервые начинает работать расписание зала — до сих
 * пор оно ни на что не влияло, потому что звать `closures.ts` было некому.
 *
 * Занятое расписанием время закрыто **только для клиента**: администратор
 * посадить человека за такой стол по-прежнему сможет, когда появится ручная
 * бронь. Поэтому проверка живёт здесь, в клиентском сценарии, а не в общей
 * функции записи.
 *
 * Оплаты в этом заходе нет: бронь заводится со статусом `BOOKED` и
 * посчитанной ценой, но без холда в ЮKassa. Холд пристроится сюда же, когда
 * будут оферта и платёжный шлюз, — цена уже считается и уже фиксируется
 * копией в `priceAtBooking`.
 */
@Injectable()
export class BookingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Что свободно в зале на дату.
   *
   * Клиенту отдаётся только «занято», без причины: расписание клуба — его
   * внутренняя кухня, а для выбора времени достаточно знать, что стол занят.
   */
  async findDay(tenantId: string, hallId: string, date: string): Promise<BookingDay> {
    assertDateFormat(date);

    const { timezone } = await this.tenant(tenantId);
    const hall = await this.hall(tenantId, hallId);

    this.assertWithinHorizon(date, timezone);

    const tables = await this.prisma.table.findMany({
      where: { tenantId, hallId },
      select: { id: true, label: true },
      orderBy: { label: 'asc' },
    });

    const busyByTable = await this.busyByTable(
      tenantId,
      hallId,
      date,
      timezone,
      tables.map((table) => table.id),
    );

    return {
      hallId,
      date,
      bookingStep: hall.bookingStep,
      stepMinutes: STEP_MINUTES[hall.bookingStep],
      openMinute: OPEN_MINUTE,
      closeMinute: CLOSE_MINUTE,
      earliestMinute: earliestMinute(date, timezone),
      hasRobotOption: hall.hasRobotOption,
      tables: tables.map((table) => ({
        tableId: table.id,
        label: table.label,
        busy: mergeBusy(busyByTable.get(table.id) ?? []),
      })),
    };
  }

  /** Сколько будет стоить аренда такой длительности — до подтверждения брони. */
  async quote(
    tenantId: string,
    hallId: string,
    durationMinutes: number,
    withRobot: boolean,
  ): Promise<BookingQuote> {
    const hall = await this.hall(tenantId, hallId);

    if (withRobot && !hall.hasRobotOption) {
      throw new BadRequestException('В этом зале нет аренды с роботом');
    }

    return quote(hall, durationMinutes, withRobot);
  }

  /**
   * Бронь стола клиентом.
   *
   * Проверка занятости стоит и здесь, и в базе. Здесь — ради внятного ответа
   * («стол в это время уже занят»), в базе — потому что она единственная
   * надёжна: два одновременных запроса оба увидят стол свободным, и развести
   * их может только exclusion-констрейнт.
   */
  async create(
    tenantId: string,
    clientId: string,
    dto: CreateBookingRequest,
  ): Promise<ClientBooking> {
    const { timezone } = await this.tenant(tenantId);

    const table = await this.prisma.table.findFirst({
      where: { id: dto.tableId, tenantId },
      select: { id: true, hallId: true, hall: { select: HALL_PRICING } },
    });

    if (!table) {
      throw new NotFoundException('Стол не найден');
    }

    const startsAt = parseInstant(dto.startsAt);
    const start = localParts(startsAt, timezone);

    this.assertWithinHorizon(start.date, timezone);

    if (dto.withRobot && !table.hall.hasRobotOption) {
      throw new BadRequestException('В этом зале нет аренды с роботом');
    }

    const busy = await this.busyByTable(tenantId, table.hallId, start.date, timezone, [table.id]);

    const violation = bookingViolation({
      startMinute: start.minutes,
      durationMinutes: dto.durationMinutes,
      stepMinutes: STEP_MINUTES[table.hall.bookingStep],
      earliestMinute: earliestMinute(start.date, timezone),
      busy: mergeBusy(busy.get(table.id) ?? []),
    });

    if (violation) {
      throw new BadRequestException(violation);
    }

    const endsAt = new Date(startsAt.getTime() + dto.durationMinutes * 60_000);
    const price = quote(table.hall, dto.durationMinutes, dto.withRobot).price;

    let created: BookingRow;

    try {
      created = await this.prisma.tableBooking.create({
        data: {
          tenantId,
          tableId: table.id,
          clientId,
          withRobot: dto.withRobot,
          startsAt,
          endsAt,
          // Копия цены на момент брони: поднятый через месяц прайс не должен
          // переписывать то, о чём клуб уже договорился с клиентом.
          priceAtBooking: price,
        },
        select: BOOKING_SELECT,
      });
    } catch (error) {
      // Пересечение с чужой бронью ловит exclusion-констрейнт. Prisma такую
      // ошибку не классифицирует — узнать её можно только по имени
      // констрейнта в тексте.
      if (String(error).includes('TableBooking_no_overlap')) {
        throw new ConflictException('Этот стол только что заняли — выберите другое время');
      }

      throw error;
    }

    return this.present(created, await this.tiers(tenantId));
  }

  /** Брони клиента: свежие сверху. */
  async listMine(tenantId: string, clientId: string): Promise<ClientBooking[]> {
    const bookings = await this.prisma.tableBooking.findMany({
      where: { tenantId, clientId },
      select: BOOKING_SELECT,
      orderBy: { startsAt: 'desc' },
    });

    const tiers = await this.tiers(tenantId);

    return bookings.map((booking) => this.present(booking, tiers));
  }

  /**
   * Отмена брони клиентом.
   *
   * Процент списания фиксируется в момент отмены, а не считается при показе:
   * политика клуба может измениться завтра, и тогда уже закрытая бронь задним
   * числом сменила бы условия.
   *
   * Денег это пока не двигает — платёжного шлюза нет. `chargeRatio`
   * записывается именно для того, чтобы, когда он появится, было от чего
   * считать списание.
   */
  async cancel(tenantId: string, clientId: string, bookingId: string): Promise<ClientBooking> {
    const booking = await this.prisma.tableBooking.findFirst({
      where: { id: bookingId, tenantId, clientId },
      select: BOOKING_SELECT,
    });

    if (!booking) {
      throw new NotFoundException('Бронь не найдена');
    }

    if (booking.status !== BookingStatus.BOOKED) {
      throw new BadRequestException('Эту бронь уже нельзя отменить');
    }

    const tiers = await this.tiers(tenantId);
    const percent = cancellationPercent(tiers, minutesUntil(booking.startsAt));

    const cancelled = await this.prisma.tableBooking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.CANCELLED,
        cancelledAt: new Date(),
        chargeRatio: percent,
      },
      select: BOOKING_SELECT,
    });

    return this.present(cancelled, tiers);
  }

  // --- Внутреннее ----------------------------------------------------------

  /**
   * Занятое время столов на дату, в минутах от местной полуночи.
   *
   * Два источника: расписание зала (шаблон недели или правка на дату) и уже
   * заведённые брони. Клиенту они приходят одним списком — различать их ему
   * незачем, а причина занятости его не касается.
   */
  private async busyByTable(
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

    const [template, day] = await Promise.all([
      this.prisma.tableClosureRule.findMany({
        where: { tenantId, table: { hallId } },
        select: { ...SLOT_SELECT, weekday: true, tournamentTypeId: true },
      }),
      this.prisma.hallDaySchedule.findFirst({
        where: { tenantId, hallId, date: parseDate(date) },
        select: { closures: { select: { ...SLOT_SELECT, tournamentId: true } } },
      }),
    ]);

    // Правленая дата ЗАМЕНЯЕТ шаблон целиком, а не дополняет его. Логика этого
    // выбора живёт в slotsForDate — повторять её здесь нельзя, иначе движок
    // бронирования и профиль клуба разошлись бы в понимании расписания.
    const slots = slotsForDate(
      template.map((rule) => ({ ...rule, weekday: rule.weekday as Weekday, tournamentId: null })),
      day
        ? {
            customised: true,
            closures: day.closures.map((closure) => ({ ...closure, tournamentTypeId: null })),
          }
        : null,
      weekdayOf(date),
    );

    for (const slot of slots) {
      add(slot.tableId, { startMinute: slot.startMinute, endMinute: slot.endMinute });
    }

    const bookings = await this.prisma.tableBooking.findMany({
      where: {
        tenantId,
        tableId: { in: tableIds },
        status: { in: ACTIVE },
        // Полуоткрытый промежуток суток: бронь, кончающаяся ровно в местную
        // полночь, принадлежит уходящему дню, а не наступающему.
        startsAt: { lt: instantAt(date, CLOSE_MINUTE, timezone) },
        endsAt: { gt: instantAt(date, 0, timezone) },
      },
      select: { tableId: true, startsAt: true, endsAt: true },
    });

    for (const booking of bookings) {
      add(booking.tableId, {
        startMinute: localParts(booking.startsAt, timezone).minutes,
        // Конец ровно в полночь местные сутки отдают как 1440, а не как 0:
        // иначе промежуток вывернулся бы и перестал считаться занятым.
        endMinute: localParts(booking.endsAt, timezone).minutes || CLOSE_MINUTE,
      });
    }

    return busy;
  }

  private present(booking: BookingRow, tiers: readonly Tier[]): ClientBooking {
    return {
      id: booking.id,
      hallId: booking.table.hallId,
      hallName: booking.table.hall.name,
      tableId: booking.tableId,
      tableLabel: booking.table.label,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
      withRobot: booking.withRobot,
      price: booking.priceAtBooking,
      status: booking.status,
      cancelledAt: booking.cancelledAt?.toISOString() ?? null,
      chargePercent: booking.chargeRatio,
      // Сколько спишется при отмене прямо сейчас — вопрос, на который клиент
      // должен получить ответ ДО нажатия кнопки, а не после.
      cancelChargePercentNow:
        booking.status === BookingStatus.BOOKED
          ? cancellationPercent(tiers, minutesUntil(booking.startsAt))
          : null,
    };
  }

  private tiers(tenantId: string): Promise<Tier[]> {
    return this.prisma.cancellationTier.findMany({
      where: { tenantId },
      select: { minMinutesBeforeStart: true, chargePercent: true },
    });
  }

  private async tenant(tenantId: string): Promise<{ timezone: string }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });

    if (!tenant) {
      throw new NotFoundException('Клуб не найден');
    }

    return tenant;
  }

  private async hall(tenantId: string, hallId: string) {
    const hall = await this.prisma.hall.findFirst({
      where: { id: hallId, tenantId },
      select: HALL_PRICING,
    });

    if (!hall) {
      throw new NotFoundException('Зал не найден');
    }

    return hall;
  }

  /**
   * Дата не в прошлом и не дальше горизонта.
   *
   * Без верхней границы бронь уехала бы на год вперёд — на время, под которое
   * расписание ещё не составлено, и администратор потом не смог бы отдать
   * этот стол под групповую тренировку.
   */
  private assertWithinHorizon(date: string, timezone: string): void {
    const today = localParts(new Date(), timezone).date;

    if (date < today) {
      throw new BadRequestException('Эта дата уже прошла');
    }

    const last = new Date(Date.parse(`${today}T00:00:00Z`) + BOOKING_HORIZON_DAYS * 86_400_000);

    if (date > last.toISOString().slice(0, 10)) {
      throw new BadRequestException(
        `Бронировать можно не дальше чем на ${BOOKING_HORIZON_DAYS} дней вперёд`,
      );
    }
  }
}

/** Сколько минут осталось до момента. Отрицательное — момент уже прошёл. */
function minutesUntil(instant: Date): number {
  return Math.floor((instant.getTime() - Date.now()) / 60_000);
}

/**
 * Минута, раньше которой на этой дате бронировать поздно.
 *
 * На сегодняшней дате это «сейчас»: время, которое уже идёт, занять нельзя.
 * На будущих — начало сетки.
 */
function earliestMinute(date: string, timezone: string): number {
  const now = localParts(new Date(), timezone);

  if (date > now.date) {
    return OPEN_MINUTE;
  }

  if (date < now.date) {
    return CLOSE_MINUTE;
  }

  return Math.max(OPEN_MINUTE, now.minutes);
}

/** День недели по ISO-8601 для календарной даты. */
function weekdayOf(date: string): Weekday {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();

  // getUTCDay отдаёт воскресенье нулём, а ISO-8601 — семёркой.
  return (day === 0 ? 7 : day) as Weekday;
}

function assertDateFormat(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new BadRequestException('Дата указывается в виде 2026-03-12');
  }
}

/** «2026-03-12» → полночь UTC этой даты: колонка типа DATE часов не хранит. */
function parseDate(date: string): Date {
  assertDateFormat(date);

  return new Date(`${date}T00:00:00Z`);
}

function parseInstant(value: string): Date {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('Момент начала указывается в формате ISO-8601');
  }

  // Секунды и миллисекунды в брони не хранятся: сетка идёт по минутам, а
  // «18:00:30» отличалось бы от «18:00» только в базе и ломало бы стык
  // соседних броней.
  if (parsed.getUTCSeconds() !== 0 || parsed.getUTCMilliseconds() !== 0) {
    throw new BadRequestException('Бронь начинается с целой минуты');
  }

  return parsed;
}
