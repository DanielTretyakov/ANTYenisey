import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingSource, BookingStatus } from '@yenisey/database';
import type {
  BookingStep,
  CancelDeskBookingRequest,
  CreateDeskBookingRequest,
  DeskBooking,
  DeskDay,
  DeskEvent,
  DeskParticipant,
  DeskPerson,
  MoveDeskBookingRequest,
} from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';
import { instantAt, localParts } from '../club/closures';
import { MembershipService } from '../club/membership.service';
import {
  bookingViolation,
  cancellationPercent,
  CLOSE_MINUTE,
  mergeBusy,
  OPEN_MINUTE,
  STEP_MINUTES,
} from '../booking/availability';
import { HALL_PRICING } from '../booking/booking.service';
import { ACTIVE_BOOKING, assertDateFormat, OccupancyService } from '../booking/occupancy.service';
import { quote } from '../booking/pricing';
import type { DeskBookingsQueryDto } from './dto/desk.dto';
import { busyAt, loadByHour, nextFrom, type BusySpan } from './hall-view';
import { moneyOf, type ChargeRow } from './revenue';

type DeskBookingsQuery = DeskBookingsQueryDto;

/**
 * Рабочее место администратора: один день одного зала.
 *
 * Отдельный модуль, а не метод `ClubController`: тот про устройство клуба —
 * цены, залы, справочники, — а это операционка, которую открывают двадцать раз
 * за смену. Смешивать их значило бы сложить в один контроллер два разных ритма
 * обращения.
 *
 * Всё собирается ОДНИМ запросом. Три ожидания вместо одного на экране, который
 * держат открытым весь вечер, — умножение задержки на ровном месте.
 *
 * Здесь полные имена и телефоны, в отличие от публичных списков, где сервер
 * сокращает их через `shortName`. Сокращение защищает записавшихся от
 * посторонних, а не клуб от собственного администратора: те же данные он видит
 * в разделе «Состав клуба», и гонять его туда за телефоном значит добавить два
 * перехода к каждому звонку.
 */

/** Человек в том объёме, в каком его показывают администратору. */
const PERSON_SELECT = {
  select: { user: { select: { id: true, fullName: true, phone: true } } },
} as const;

/** Поля записи, из которых считаются деньги. Одни и те же у всех трёх видов. */
const CHARGE_SELECT = {
  id: true,
  status: true,
  priceAtBooking: true,
  chargeRatio: true,
} as const;

/**
 * Бронь стола в том виде, в каком её показывает рабочее место.
 *
 * Форма выборки и форма ответа обязаны меняться вместе — иначе первым
 * признаком расхождения будет ошибка типов в чужом файле. Тот же приём, что в
 * `event-view.ts`.
 */
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
  source: true,
  table: { select: { label: true, hallId: true } },
  client: { select: { membership: PERSON_SELECT } },
  coach: { select: { membership: PERSON_SELECT } },
  createdBy: { select: { user: { select: { fullName: true } } } },
} as const;

type PersonRow = { user: { id: string; fullName: string; phone: string } };

type EntryRow = {
  id: string;
  status: BookingStatus;
  priceAtBooking: number;
  chargeRatio: number | null;
  client: { membership: PersonRow };
};

@Injectable()
export class DeskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly occupancy: OccupancyService,
    private readonly membership: MembershipService,
  ) {}

  async findDay(tenantId: string, hallId: string, date: string): Promise<DeskDay> {
    assertDateFormat(date);

    const hall = await this.prisma.hall.findFirst({
      where: { id: hallId, tenantId },
      select: { id: true, name: true, timezone: true },
    });

    if (!hall) {
      throw new NotFoundException('Зал не найден');
    }

    // Пояс ЗАЛА, а не клуба: залы одной организации бывают в разных регионах,
    // и «сегодня» у зала в Абакане своё. Считать по часам головного клуба
    // значит показать администратору не тот день.
    const timezone = hall.timezone;
    const now = localParts(new Date(), timezone);
    const today = now.date === date;

    const tables = await this.prisma.table.findMany({
      where: { tenantId, hallId },
      select: { id: true, label: true },
      orderBy: { label: 'asc' },
    });

    const [slots, bookings] = await Promise.all([
      this.occupancy.slotsOn(tenantId, hallId, date),
      this.bookings(tenantId, hallId, date, timezone),
    ]);

    const [events, names] = await Promise.all([
      this.events(tenantId, slots),
      this.names(tenantId, slots.flatMap((slot) => [slot.coachId, slot.clientId])),
    ]);

    const spans = this.spansByTable(slots, bookings, names, timezone);
    const spansOf = (tableId: string): BusySpan[] => spans.get(tableId) ?? [];

    return {
      hallId: hall.id,
      hallName: hall.name,
      date,
      timezone,
      today,
      // «Сейчас» существует только у сегодняшнего дня: у прошлой субботы
      // текущего момента нет, и рисовать на ней занятость «прямо сейчас»
      // значило бы соврать.
      nowMinute: today ? now.minutes : null,
      openMinute: OPEN_MINUTE,
      closeMinute: CLOSE_MINUTE,

      tables: tables.map((table) => ({
        tableId: table.id,
        label: table.label,
        busy: today ? busyAt(spansOf(table.id), now.minutes) : null,
        // У несегодняшнего дня «следующая занятость» отсчитывается от начала
        // суток: вопрос превращается из «что дальше» в «с какого часа занят».
        nextFromMinute: nextFrom(spansOf(table.id), today ? now.minutes : -1),
      })),

      bookings: bookings.map(present),

      events: events.events,
      load: loadByHour(tables.map((table) => spansOf(table.id)), OPEN_MINUTE, CLOSE_MINUTE),

      money: moneyOf({
        tables: bookings.map(charge),
        trainings: events.trainings,
        tournaments: events.tournaments,
      }),
    };
  }

  // --- Брони клуба -----------------------------------------------------------

  /**
   * Список броней клуба с фильтрами — для разбора, а не для смены.
   *
   * Свежие сверху: этот список открывают с вопросом «что было», а не «что
   * будет», и последнее интереснее давнего.
   */
  async listBookings(tenantId: string, query: DeskBookingsQuery): Promise<DeskBooking[]> {
    const rows = await this.prisma.tableBooking.findMany({
      where: {
        tenantId,
        ...(query.hallId ? { table: { hallId: query.hallId } } : {}),
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.from || query.to
          ? {
              startsAt: {
                ...(query.from ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
                // Верхняя граница включительная по дню: «по 12 марта» должно
                // захватывать сам двенадцатое, а не обрывать его полночью.
                ...(query.to ? { lt: new Date(`${query.to}T00:00:00Z`) } : {}),
              },
            }
          : {}),
      },
      select: BOOKING_SELECT,
      orderBy: { startsAt: 'desc' },
      take: query.limit ?? 100,
    });

    return rows.map(bookingRow).map(present);
  }

  /**
   * Администратор сажает человека за стол.
   *
   * Отличий от самостоятельной брони клиента ровно три, и все три — следствие
   * того, что за стойкой стоит человек, знающий про зал больше системы:
   *
   * 1. **Расписание не мешает.** Закрытое время закрыто только для
   *    самообслуживания; посадить клиента поверх запланированной тренировки
   *    администратор вправе — ради этого рабочее место и пишется.
   * 2. **Прошедшее время доступно.** Бронь задним числом нужна при сверке
   *    истории: человек играл, а записать забыли.
   * 3. **Горизонт в две недели не применяется** — это правило самозаписи.
   *
   * Что НЕ отличается: чужая бронь по-прежнему непреодолима (два человека за
   * одним столом не помещаются физически), а цену считает только сервер.
   */
  async createBooking(
    tenantId: string,
    authorId: string,
    dto: CreateDeskBookingRequest,
  ): Promise<DeskBooking> {
    const table = await this.table(tenantId, dto.tableId);
    const startsAt = parseInstant(dto.startsAt);

    await this.assertBookable(tenantId, table, startsAt, dto.durationMinutes);

    if (dto.withRobot && !table.hall.hasRobotOption) {
      throw new BadRequestException('В этом зале нет аренды с роботом');
    }

    // Человек может не состоять в клубе вовсе: по ТЗ записаться может любой
    // пользователь платформы. Привязка заводится тем же кодом, что и при
    // самостоятельной записи, — второго пути здесь быть не должно.
    await this.membership.ensureClient(tenantId, dto.clientId);

    return this.write(() =>
      this.prisma.tableBooking.create({
        data: {
          tenantId,
          tableId: table.id,
          clientId: dto.clientId,
          withRobot: dto.withRobot,
          startsAt,
          endsAt: endOf(startsAt, dto.durationMinutes),
          // Цену считает сервер и только он: второй расчёт на клиенте
          // разошёлся бы с этим молча.
          priceAtBooking: quote(table.hall, dto.durationMinutes, dto.withRobot).price,
          source: BookingSource.MANUAL,
          // Обязателен при MANUAL — это проверяет check-констрейнт. За ручной
          // бронью стоят чужие деньги, и «кто меня записал» должно иметь ответ.
          createdByUserId: authorId,
        },
        select: BOOKING_SELECT,
      }),
    );
  }

  /**
   * Перенос брони: другой стол, другое время или длительность.
   *
   * Именно перенос, а не «отменить и создать заново»: отмена зафиксировала бы
   * процент списания и испортила клиенту статистику отмен — за то, что стол
   * переставил администратор.
   *
   * Цена пересчитывается и переписывает `priceAtBooking`. Это осознанно: пока
   * за бронью не стоит холд в ЮKassa, копия цены отражает договорённость, а
   * перенос её меняет. Когда шлюз появится, перенос станет отменой плюс новой
   * бронью — иначе списанное и начисленное разойдутся.
   */
  async moveBooking(
    tenantId: string,
    bookingId: string,
    dto: MoveDeskBookingRequest,
  ): Promise<DeskBooking> {
    const booking = await this.booking(tenantId, bookingId);

    if (booking.status !== BookingStatus.BOOKED) {
      throw new BadRequestException('Переносить можно только активную бронь');
    }

    const table = await this.table(tenantId, dto.tableId);
    const startsAt = parseInstant(dto.startsAt);

    await this.assertBookable(tenantId, table, startsAt, dto.durationMinutes, bookingId);

    return this.write(() =>
      this.prisma.tableBooking.update({
        where: { id: bookingId },
        data: {
          tableId: table.id,
          startsAt,
          endsAt: endOf(startsAt, dto.durationMinutes),
          priceAtBooking: quote(table.hall, dto.durationMinutes, booking.withRobot).price,
        },
        select: BOOKING_SELECT,
      }),
    );
  }

  /**
   * Отмена брони администратором.
   *
   * Процент списания фиксируется в момент отмены по политике клуба — тот же
   * расчёт, что у клиентской отмены, и второго быть не должно.
   *
   * `waiveCharge` прощает списание целиком: сломался стол, отменили занятие,
   * клуб виноват. Без него администратору осталось бы только звонить в
   * бухгалтерию — «мы сами виноваты» в политику отмены не заложено.
   */
  async cancelBooking(
    tenantId: string,
    bookingId: string,
    dto: CancelDeskBookingRequest,
  ): Promise<DeskBooking> {
    const booking = await this.booking(tenantId, bookingId);

    if (booking.status !== BookingStatus.BOOKED) {
      throw new BadRequestException('Эту бронь уже нельзя отменить');
    }

    const tiers = await this.prisma.cancellationTier.findMany({
      where: { tenantId },
      select: { minMinutesBeforeStart: true, chargePercent: true },
    });

    const minutes = Math.floor((booking.startsAt.getTime() - Date.now()) / 60_000);

    const updated = await this.prisma.tableBooking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.CANCELLED,
        // Момент отмены обязателен — check-констрейнт: от него считается
        // процент, и запись без него делает спор о деньгах неразрешимым.
        cancelledAt: new Date(),
        chargeRatio: dto.waiveCharge ? 0 : cancellationPercent(tiers, minutes),
      },
      select: BOOKING_SELECT,
    });

    return present(bookingRow(updated));
  }

  // --- Внутреннее ------------------------------------------------------------

  /**
   * Стол вместе с ценами и поясом зала, в котором он стоит.
   *
   * Одним запросом: отдельный поход к клубу за поясом означал бы, что зал в
   * другом регионе тарифицируется по чужим границам суток.
   */
  private async table(tenantId: string, tableId: string) {
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, tenantId },
      select: { id: true, hallId: true, hall: { select: HALL_PRICING } },
    });

    if (!table) {
      throw new NotFoundException('Стол не найден');
    }

    return table;
  }

  private async booking(tenantId: string, bookingId: string) {
    const booking = await this.prisma.tableBooking.findFirst({
      where: { id: bookingId, tenantId },
      select: { id: true, status: true, startsAt: true, withRobot: true },
    });

    if (!booking) {
      throw new NotFoundException('Бронь не найдена');
    }

    return booking;
  }

  /**
   * Можно ли занять этот стол в это время.
   *
   * Проверяются только чужие БРОНИ — расписание администратору не помеха.
   * Проверка стоит и здесь, и в базе: здесь ради внятного ответа, в базе
   * потому что она единственная надёжна — два одновременных запроса оба
   * увидят стол свободным, и развести их может только exclusion-констрейнт.
   */
  private async assertBookable(
    tenantId: string,
    table: { id: string; hall: { timezone: string; bookingStep: BookingStep } },
    startsAt: Date,
    durationMinutes: number,
    exceptId?: string,
  ): Promise<void> {
    const timezone = table.hall.timezone;
    const start = localParts(startsAt, timezone);

    const rows = await this.prisma.tableBooking.findMany({
      where: {
        tenantId,
        tableId: table.id,
        status: { in: ACTIVE_BOOKING },
        ...(exceptId ? { id: { not: exceptId } } : {}),
        startsAt: { lt: instantAt(start.date, CLOSE_MINUTE, timezone) },
        endsAt: { gt: instantAt(start.date, 0, timezone) },
      },
      select: { startsAt: true, endsAt: true },
    });

    const violation = bookingViolation({
      startMinute: start.minutes,
      durationMinutes,
      stepMinutes: STEP_MINUTES[table.hall.bookingStep],
      // Ноль, а не «сейчас»: бронь задним числом администратору нужна — при
      // сверке истории человек играл, а записать забыли.
      earliestMinute: 0,
      busy: mergeBusy(
        rows.map((row) => ({
          startMinute: localParts(row.startsAt, timezone).minutes,
          endMinute: localParts(row.endsAt, timezone).minutes || CLOSE_MINUTE,
        })),
      ),
    });

    if (violation) {
      throw new BadRequestException(violation);
    }
  }

  /**
   * Запись брони с переводом отказа базы в понятный ответ.
   *
   * Пересечение ловит exclusion-констрейнт. Prisma такую ошибку не
   * классифицирует — узнать её можно только по имени констрейнта в тексте.
   */
  private async write(action: () => Promise<BookingRow>): Promise<DeskBooking> {
    try {
      return present(bookingRow(await action()));
    } catch (error) {
      if (String(error).includes('TableBooking_no_overlap')) {
        throw new ConflictException('Этот стол в это время уже занят другой бронью');
      }

      throw error;
    }
  }

  /**
   * Занятость каждого стола: окна расписания и брони одним списком.
   *
   * Источник у промежутка сохраняется, а не стирается, как в клиентской сетке:
   * за бронью стоит человек, который заплатит, а за окном расписания — план
   * самого клуба, и администратор вправе распорядиться ими по-разному.
   */
  private spansByTable(
    slots: readonly {
      tableId: string;
      startMinute: number;
      endMinute: number;
      purpose: BusySpan['purpose'];
      coachId: string | null;
      clientId: string | null;
    }[],
    bookings: readonly BookingWithPerson[],
    names: Map<string, string>,
    timezone: string,
  ): Map<string, BusySpan[]> {
    const spans = new Map<string, BusySpan[]>();

    const add = (tableId: string, span: BusySpan): void => {
      const list = spans.get(tableId) ?? [];
      list.push(span);
      spans.set(tableId, list);
    };

    for (const slot of slots) {
      add(slot.tableId, {
        startMinute: slot.startMinute,
        endMinute: slot.endMinute,
        source: 'SCHEDULE',
        purpose: slot.purpose,
        // За тренировкой и спаррингом стоит тренер, за арендой и роботом —
        // закреплённый клиент. То же правило, что у `attachedPersonId`
        // в closures.ts: обоих полей сразу у окна не бывает.
        person: names.get(slot.coachId ?? slot.clientId ?? '') ?? null,
      });
    }

    for (const booking of bookings) {
      add(booking.tableId, {
        startMinute: localParts(booking.startsAt, timezone).minutes,
        // Конец ровно в полночь местные сутки отдают как 1440, а не как 0:
        // иначе промежуток вывернулся бы и перестал считаться занятым.
        endMinute: localParts(booking.endsAt, timezone).minutes || CLOSE_MINUTE,
        source: 'BOOKING',
        // Робот — отдельная услуга со своей ценой, а не наценка поверх аренды,
        // и в сетке он тоже отдельное назначение.
        purpose: booking.withRobot ? 'ROBOT' : 'RENT',
        person: booking.client.fullName,
      });
    }

    return spans;
  }

  /**
   * Брони столов зала, попадающие в местные сутки даты.
   *
   * Без фильтра по статусу, в отличие от клиентской сетки: отменённая бронь —
   * часть дня, за ней могло стоять списание, и спрятать её значило бы занизить
   * итог. Что показывать в ленте, а что нет, решает страница.
   *
   * Занятость при этом считается только по активным: отменённая бронь стол не
   * занимает — иначе освободившееся время выглядело бы занятым.
   */
  private async bookings(
    tenantId: string,
    hallId: string,
    date: string,
    timezone: string,
  ): Promise<BookingWithPerson[]> {
    const rows = await this.prisma.tableBooking.findMany({
      where: {
        tenantId,
        table: { hallId },
        // Полуоткрытый промежуток суток: бронь, кончающаяся ровно в местную
        // полночь, принадлежит уходящему дню, а не наступающему.
        startsAt: { lt: instantAt(date, CLOSE_MINUTE, timezone) },
        endsAt: { gt: instantAt(date, 0, timezone) },
      },
      select: BOOKING_SELECT,
      orderBy: { startsAt: 'asc' },
    });

    return rows.map(bookingRow);
  }

  /**
   * Занятия и турниры, стоящие в сетке этого зала на эту дату, — с составом.
   *
   * Берутся из окон расписания, а не запросом по дате, и причина в схеме: у
   * `TrainingSession` нет зала, с залом его связывает только сетка. Спросить
   * «занятия этого зала на эту дату» иначе нечем, а запрос по одной дате
   * притащил бы в смену занятия соседнего зала.
   *
   * Состав приезжает сразу, а не по нажатию: экран смены открывают именно
   * затем, чтобы увидеть, кого ждать, и второй запрос на каждое занятие
   * превратил бы это в десяток походов к серверу.
   */
  private async events(
    tenantId: string,
    slots: readonly { trainingSessionId: string | null; tournamentId: string | null }[],
  ): Promise<{ events: DeskEvent[]; trainings: ChargeRow[]; tournaments: ChargeRow[] }> {
    const sessionIds = [...new Set(slots.map((slot) => slot.trainingSessionId).filter(isId))];
    const tournamentIds = [...new Set(slots.map((slot) => slot.tournamentId).filter(isId))];

    if (sessionIds.length === 0 && tournamentIds.length === 0) {
      return { events: [], trainings: [], tournaments: [] };
    }

    const [sessions, tournaments] = await Promise.all([
      this.prisma.trainingSession.findMany({
        where: { tenantId, id: { in: sessionIds } },
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          capacity: true,
          trainingType: { select: { name: true, price: true } },
          coach: { select: { membership: PERSON_SELECT } },
          bookings: { select: { ...CHARGE_SELECT, client: { select: { membership: PERSON_SELECT } } } },
        },
      }),
      this.prisma.tournament.findMany({
        where: { tenantId, id: { in: tournamentIds } },
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          tournamentType: { select: { name: true, price: true } },
          registrations: {
            select: { ...CHARGE_SELECT, client: { select: { membership: PERSON_SELECT } } },
          },
        },
      }),
    ]);

    const events: DeskEvent[] = [
      ...sessions.map((session) => ({
        id: session.id,
        kind: 'TRAINING' as const,
        title: session.trainingType.name,
        startsAt: session.startsAt.toISOString(),
        endsAt: session.endsAt.toISOString(),
        price: session.trainingType.price,
        capacity: session.capacity,
        coachName: session.coach.membership.user.fullName,
        participants: session.bookings.map(participant),
      })),
      ...tournaments.map((tournament) => ({
        id: tournament.id,
        kind: 'TOURNAMENT' as const,
        title: tournament.tournamentType.name,
        startsAt: tournament.startsAt.toISOString(),
        endsAt: tournament.endsAt.toISOString(),
        price: tournament.tournamentType.price,
        // Лимита мест у турнира нет вовсе — число записавшихся справочно.
        capacity: null,
        coachName: null,
        participants: tournament.registrations.map(participant),
      })),
    ];

    return {
      events: events.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      // Деньги считаются по КОПИЯМ цен на момент записи, а не по цене типа:
      // поднятый на прошлой неделе прайс не должен задним числом переписывать
      // то, о чём клуб уже договорился с клиентом.
      trainings: sessions.flatMap((session) => session.bookings.map(charge)),
      tournaments: tournaments.flatMap((tournament) => tournament.registrations.map(charge)),
    };
  }

  /**
   * Имена людей по их идентификаторам — одним запросом на весь экран.
   *
   * Тренер ведёт по четыре окна подряд, и спрашивать имя на каждое значило бы
   * сходить к базе двадцать раз ради пяти строк.
   */
  private async names(
    tenantId: string,
    ids: readonly (string | null)[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(isId))];

    if (unique.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.tenantMembership.findMany({
      where: { tenantId, userId: { in: unique } },
      select: { userId: true, user: { select: { fullName: true } } },
    });

    return new Map(rows.map((row) => [row.userId, row.user.fullName]));
  }
}

/** Строка брони как её отдаёт Prisma по BOOKING_SELECT. */
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
  source: BookingSource;
  table: { label: string; hallId: string };
  client: { membership: PersonRow } | null;
  coach: { membership: PersonRow } | null;
  createdBy: { user: { fullName: string } } | null;
}

/** Та же строка, но с уже разобранным «кто за столом». */
type BookingWithPerson = Omit<BookingRow, 'client' | 'coach'> & { client: DeskPerson };

function bookingRow(row: BookingRow): BookingWithPerson {
  const { coach, ...rest } = row;

  return {
    ...rest,
    // Заполнено ровно одно из двух — это проверяет check-констрейнт
    // `TableBooking_client_xor_coach`. Спарринг инициирует тренер, и за столом
    // в этом случае он.
    client: personOf(row.client ?? coach),
  };
}

function present(row: BookingWithPerson): DeskBooking {
  return {
    id: row.id,
    tableId: row.tableId,
    tableLabel: row.table.label,
    hallId: row.table.hallId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    withRobot: row.withRobot,
    price: row.priceAtBooking,
    status: row.status,
    client: row.client,
    manual: row.source === 'MANUAL',
    createdBy: row.createdBy?.user.fullName ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    chargePercent: row.chargeRatio,
  };
}

function personOf(row: { membership: PersonRow } | null): DeskPerson {
  // Ни клиента, ни тренера у брони быть не может — это запрещено
  // check-констрейнтом. Пустая строка здесь означала бы, что констрейнт сняли.
  if (!row) {
    return { userId: '', fullName: 'без клиента', phone: '' };
  }

  return {
    userId: row.membership.user.id,
    fullName: row.membership.user.fullName,
    phone: row.membership.user.phone,
  };
}

const participant = (row: EntryRow): DeskParticipant => ({
  ...personOf(row.client),
  entryId: row.id,
  status: row.status,
});

const charge = (row: {
  priceAtBooking: number;
  status: BookingStatus;
  chargeRatio: number | null;
}): ChargeRow => ({
  price: row.priceAtBooking,
  status: row.status,
  chargeRatio: row.chargeRatio,
});

function isId(value: string | null): value is string {
  return value !== null;
}

/** Конец брони: начало плюс длительность. Хранится явным моментом, не длиной. */
function endOf(startsAt: Date, durationMinutes: number): Date {
  return new Date(startsAt.getTime() + durationMinutes * 60_000);
}

/**
 * Момент начала из строки запроса.
 *
 * Секунды и миллисекунды в брони не хранятся: сетка идёт по минутам, а
 * «18:00:30» отличалось бы от «18:00» только в базе и ломало бы стык соседних
 * броней. Та же проверка, что у клиентской заявки.
 */
function parseInstant(value: string): Date {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('Момент начала указывается в формате ISO-8601');
  }

  if (parsed.getUTCSeconds() !== 0 || parsed.getUTCMilliseconds() !== 0) {
    throw new BadRequestException('Бронь начинается с целой минуты');
  }

  return parsed;
}
