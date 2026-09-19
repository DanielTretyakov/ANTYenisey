import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingSource, BookingStatus, Prisma } from '@yenisey/database';
import type {
  BookingStep,
  CancelDeskBookingRequest,
  CreateDeskBookingRequest,
  DeskBooking,
  DeskDay,
  DeskEvent,
  DeskMarkInfo,
  DeskParticipant,
  DeskPerson,
  MoveDeskBookingRequest,
} from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';
import { attendancePhase, autoNoShowAt } from '../attendance/attendance-rules';
import {
  AttendanceService,
  type Actor,
  type ClubAttendancePolicy,
} from '../attendance/attendance.service';
import { instantAt, localParts } from '../club/closures';
import { MembershipService } from '../club/membership.service';
import {
  bookingViolation,
  cancellationOpen,
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
  isSparring: true,
  table: { select: { label: true, hallId: true, hall: { select: { name: true } } } },
  client: { select: { membership: PERSON_SELECT } },
  coach: { select: { membership: PERSON_SELECT } },
  createdBy: { select: { user: { select: { fullName: true } } } },
} as const;

/** Занятие с составом и деньгами — одна форма для ленты дня и «Требует отметки». */
const SESSION_SELECT = {
  id: true,
  startsAt: true,
  endsAt: true,
  capacity: true,
  trainingType: { select: { name: true, price: true } },
  coach: { select: { membership: PERSON_SELECT } },
  // По порядку записи: без сортировки база отдаёт строки как придётся, и
  // после каждой отметки состав перетасовывался бы у администратора под рукой.
  bookings: {
    select: { ...CHARGE_SELECT, client: { select: { membership: PERSON_SELECT } } },
    orderBy: { createdAt: 'asc' },
  },
} as const;

const TOURNAMENT_SELECT = {
  id: true,
  startsAt: true,
  endsAt: true,
  tournamentType: { select: { name: true, price: true } },
  registrations: {
    select: { ...CHARGE_SELECT, client: { select: { membership: PERSON_SELECT } } },
    orderBy: { createdAt: 'asc' },
  },
} as const;

type SessionRow = Prisma.TrainingSessionGetPayload<{ select: typeof SESSION_SELECT }>;
type TournamentRow = Prisma.TournamentGetPayload<{ select: typeof TOURNAMENT_SELECT }>;

/** Мероприятия как их отдаёт база — до того, как их покажут. */
interface EventRows {
  sessions: SessionRow[];
  tournaments: TournamentRow[];
}

/**
 * Сколько записей каждого вида в «Требует отметки». Больше — значит отметку
 * давно не ведут, и список длиннее экрана ничем не поможет: остальное всё
 * равно закроет джоба.
 */
const PENDING_LIMIT = 100;

/**
 * То, что нужно для показа записи, кроме неё самой: момент, от которого
 * считаются фазы, правила клуба и кто ставил нынешние отметки.
 */
interface View {
  now: Date;
  policy: ClubAttendancePolicy;
  marks: Map<string, DeskMarkInfo>;
}

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
    private readonly attendance: AttendanceService,
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
    const moment = new Date();
    const now = localParts(moment, timezone);
    const today = now.date === date;

    const [tables, policy] = await Promise.all([
      this.prisma.table.findMany({
        where: { tenantId, hallId },
        select: { id: true, label: true },
        orderBy: { label: 'asc' },
      }),
      this.attendance.policy(tenantId),
    ]);

    const [slots, bookings] = await Promise.all([
      this.occupancy.slotsOn(tenantId, hallId, date),
      this.bookings(tenantId, hallId, date, timezone),
    ]);

    const dayStart = instantAt(date, 0, timezone);
    const dayEnd = instantAt(date, CLOSE_MINUTE, timezone);

    const [events, names, pendingRows, visits, unplaced] = await Promise.all([
      this.eventRows(tenantId, {
        sessionIds: slots.map((slot) => slot.trainingSessionId),
        tournamentIds: slots.map((slot) => slot.tournamentId),
      }),
      this.names(tenantId, slots.map((slot) => slot.coachId)),
      this.pendingRows(tenantId, moment, policy),
      // Визит с порога залу не принадлежит — у него нет стола. Показывается
      // по клубу за местные сутки зала.
      this.attendance.visitsBetween(tenantId, dayStart, dayEnd),
      this.unplacedRows(tenantId, dayStart, dayEnd),
    ]);

    // Неотмеченное этого дня — в «Требует отметки», даже если оно старше
    // начала учёта: такое джоба не закроет, и кроме администратора некому.
    const started = (row: { startsAt: Date }): boolean => row.startsAt <= moment;
    const pending = {
      bookings: uniqueById([
        ...pendingRows.bookings,
        ...bookings.filter((row) => row.status === BookingStatus.BOOKED && started(row)),
      ]),
      events: {
        sessions: uniqueById([
          ...pendingRows.events.sessions,
          ...events.sessions.filter((row) => started(row) && row.bookings.some(isUnmarked)),
        ]),
        tournaments: uniqueById([
          ...pendingRows.events.tournaments,
          ...events.tournaments.filter((row) => started(row) && row.registrations.some(isUnmarked)),
        ]),
      },
    };

    const view: View = {
      now: moment,
      policy,
      marks: await this.attendance.marksOf(tenantId, [
        ...markedIds(bookings),
        ...markedIds(events.sessions.flatMap((row) => row.bookings)),
        ...markedIds(events.tournaments.flatMap((row) => row.registrations)),
        ...markedIds(pending.events.sessions.flatMap((row) => row.bookings)),
        ...markedIds(pending.events.tournaments.flatMap((row) => row.registrations)),
        ...markedIds(unplaced.sessions.flatMap((row) => row.bookings)),
        ...markedIds(unplaced.tournaments.flatMap((row) => row.registrations)),
      ]),
    };

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

      bookings: bookings.map((row) => present(row, view)),

      events: presentEvents(events, view),
      load: loadByHour(tables.map((table) => spansOf(table.id)), OPEN_MINUTE, CLOSE_MINUTE),

      // Деньги считаются по КОПИЯМ цен на момент записи, а не по цене типа:
      // поднятый на прошлой неделе прайс не должен задним числом переписывать
      // то, о чём клуб уже договорился с клиентом.
      money: moneyOf({
        tables: bookings.map(charge),
        trainings: events.sessions.flatMap((session) => session.bookings.map(charge)),
        tournaments: events.tournaments.flatMap((tournament) => tournament.registrations.map(charge)),
      }),

      policy: {
        noShowChargePercent: policy.noShowChargePercent,
        reminderAfterMinutes: policy.reminderAfterMinutes,
        autoNoShowAfterMinutes: policy.autoNoShowAfterMinutes,
        trackedSince: policy.trackedSince.toISOString(),
      },
      pending: {
        bookings: pending.bookings
          .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
          .map((row) => present(row, view)),
        events: presentEvents(pending.events, view),
      },
      visits,
      unplaced: presentEvents(unplaced, view),
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

    return this.presentBookings(tenantId, rows);
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
   *
   * Бронь, которая уже началась, заводится сразу «пришёл» — в той же
   * транзакции. Это не только сверка истории: администратор сажает человека
   * «прямо сейчас», и начало по шагу зала оказывается на пару минут в прошлом.
   * Без отметки такую бронь через сутки закрыла бы неявкой джоба — со
   * списанием за игру, которая состоялась у администратора на глазах.
   */
  async createBooking(
    tenantId: string,
    actor: Actor,
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

    const policy = await this.attendance.policy(tenantId);

    const id = await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.tableBooking.create({
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
            createdByUserId: actor.userId,
          },
          select: { id: true },
        });

        const now = new Date();

        if (startsAt.getTime() <= now.getTime()) {
          await this.attendance.applyInTx(
            tx,
            tenantId,
            'TABLE',
            created.id,
            { status: 'ATTENDED', reason: 'Бронь заведена после начала — человек уже за столом' },
            actor,
            { now, noShowChargePercent: policy.noShowChargePercent },
          );
        }

        return created.id;
      }),
    );

    return this.presentOne(tenantId, id);
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

    await this.write(() =>
      this.prisma.tableBooking.update({
        where: { id: bookingId },
        data: {
          tableId: table.id,
          startsAt,
          endsAt: endOf(startsAt, dto.durationMinutes),
          priceAtBooking: quote(table.hall, dto.durationMinutes, booking.withRobot).price,
        },
        select: { id: true },
      }),
    );

    return this.presentOne(tenantId, bookingId);
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
   *
   * После начала не отменяет и администратор — та же граница, что у клиента.
   * Началось — значит, отмечается: пришёл или не пришёл. Для «клуб виноват»
   * есть неявка без списания, с причиной в журнале.
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

    if (!cancellationOpen(booking.startsAt, new Date())) {
      throw new BadRequestException('Уже началось — отметьте присутствие или неявку');
    }

    const tiers = await this.prisma.cancellationTier.findMany({
      where: { tenantId },
      select: { minMinutesBeforeStart: true, chargePercent: true },
    });

    const minutes = Math.floor((booking.startsAt.getTime() - Date.now()) / 60_000);

    // Условие на статус — против гонки с клиентом, отменившим ту же бронь.
    const { count } = await this.prisma.tableBooking.updateMany({
      where: { id: bookingId, status: BookingStatus.BOOKED },
      data: {
        status: BookingStatus.CANCELLED,
        // Момент отмены обязателен — check-констрейнт: от него считается
        // процент, и запись без него делает спор о деньгах неразрешимым.
        cancelledAt: new Date(),
        chargeRatio: dto.waiveCharge ? 0 : cancellationPercent(tiers, minutes),
      },
    });

    if (count === 0) {
      throw new ConflictException('Бронь уже изменилась — обновите страницу');
    }

    return this.presentOne(tenantId, bookingId);
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
  private async write<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
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
        // За окном стоит только тренер: клиента у окна нет — человека за
        // столом держит бронь (`attachedPersonId` в closures.ts).
        person: names.get(slot.coachId ?? '') ?? null,
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
  private async eventRows(
    tenantId: string,
    ids: { sessionIds: readonly (string | null)[]; tournamentIds: readonly (string | null)[] },
  ): Promise<EventRows> {
    const sessionIds = [...new Set(ids.sessionIds.filter(isId))];
    const tournamentIds = [...new Set(ids.tournamentIds.filter(isId))];

    const [sessions, tournaments] = await Promise.all([
      sessionIds.length === 0
        ? []
        : this.prisma.trainingSession.findMany({
            where: { tenantId, id: { in: sessionIds } },
            select: SESSION_SELECT,
          }),
      tournamentIds.length === 0
        ? []
        : this.prisma.tournament.findMany({
            where: { tenantId, id: { in: tournamentIds } },
            select: TOURNAMENT_SELECT,
          }),
    ]);

    return { sessions, tournaments };
  }

  /**
   * Что ждёт отметки по всему клубу — независимо от зала и даты на экране.
   *
   * Лента дня берёт мероприятия из сетки зала и не видит ни вчерашнего, ни
   * заведённого не в сетке. Без общего списка такое не отметил бы никто, кроме
   * джобы, — а джоба ставит неявку, и человеку, который был, спишут 100%.
   *
   * Только то, что в учёте (закончилось не раньше `trackedSince`): старшее
   * джоба не тронет, и собирать сюда всю историю клуба незачем. Старое
   * неотмеченное видно в «Требует отметки» своего дня.
   */
  private async pendingRows(
    tenantId: string,
    now: Date,
    policy: ClubAttendancePolicy,
  ): Promise<{ bookings: BookingWithPerson[]; events: EventRows }> {
    const within = { startsAt: { lte: now }, endsAt: { gte: policy.trackedSince } };
    const booked = { status: BookingStatus.BOOKED };

    const [bookings, sessions, tournaments] = await Promise.all([
      this.prisma.tableBooking.findMany({
        where: { tenantId, ...booked, ...within },
        select: BOOKING_SELECT,
        orderBy: { startsAt: 'asc' },
        take: PENDING_LIMIT,
      }),
      this.prisma.trainingSession.findMany({
        where: { tenantId, ...within, bookings: { some: booked } },
        select: SESSION_SELECT,
        orderBy: { startsAt: 'asc' },
        take: PENDING_LIMIT,
      }),
      this.prisma.tournament.findMany({
        where: { tenantId, ...within, registrations: { some: booked } },
        select: TOURNAMENT_SELECT,
        orderBy: { startsAt: 'asc' },
        take: PENDING_LIMIT,
      }),
    ]);

    return { bookings: bookings.map(bookingRow), events: { sessions, tournaments } };
  }

  /**
   * Мероприятия дня, не стоящие ни в одной сетке клуба.
   *
   * Сетка — единственное, что связывает занятие с залом, и без неё занятие
   * не видно ни в одном зале. Отдаётся в каждом: как визит с порога, оно
   * принадлежит клубу, а не залу.
   */
  private async unplacedRows(tenantId: string, from: Date, to: Date): Promise<EventRows> {
    const where = { tenantId, startsAt: { gte: from, lt: to }, dayClosures: { none: {} } };

    const [sessions, tournaments] = await Promise.all([
      this.prisma.trainingSession.findMany({ where, select: SESSION_SELECT }),
      this.prisma.tournament.findMany({ where, select: TOURNAMENT_SELECT }),
    ]);

    return { sessions, tournaments };
  }

  /** Брони в том виде, в каком их отдаёт рабочее место, — с отметками. */
  private async presentBookings(tenantId: string, rows: BookingRow[]): Promise<DeskBooking[]> {
    const [policy, marks] = await Promise.all([
      this.attendance.policy(tenantId),
      this.attendance.marksOf(tenantId, markedIds(rows)),
    ]);

    const view: View = { now: new Date(), policy, marks };

    return rows.map(bookingRow).map((row) => present(row, view));
  }

  private async presentOne(tenantId: string, id: string): Promise<DeskBooking> {
    const row = await this.prisma.tableBooking.findUniqueOrThrow({
      where: { id },
      select: BOOKING_SELECT,
    });

    const [booking] = await this.presentBookings(tenantId, [row]);

    return booking!;
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
  isSparring: boolean;
  table: { label: string; hallId: string; hall: { name: string } };
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

function present(row: BookingWithPerson, view: View): DeskBooking {
  return {
    id: row.id,
    tableId: row.tableId,
    tableLabel: row.table.label,
    hallId: row.table.hallId,
    hallName: row.table.hall.name,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    withRobot: row.withRobot,
    price: row.priceAtBooking,
    status: row.status,
    client: row.client,
    manual: row.source === 'MANUAL',
    sparring: row.isSparring,
    createdBy: row.createdBy?.user.fullName ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    chargePercent: row.chargeRatio,
    ...timing(row, row.status === BookingStatus.BOOKED, view),
    mark: view.marks.get(row.id) ?? null,
  };
}

/**
 * Где запись по отношению к отметке и когда её закроет система.
 *
 * Срок автонеявки — только у того, что ещё ждёт: у отмеченного и отменённого
 * система уже ничего не сделает, и «отметит неявку в 19:00» было бы враньём.
 */
function timing(
  row: { startsAt: Date; endsAt: Date },
  waiting: boolean,
  view: View,
): Pick<DeskBooking, 'phase' | 'autoNoShowAt'> {
  return {
    phase: attendancePhase(row, view.policy, view.now),
    autoNoShowAt: waiting ? (autoNoShowAt(row.endsAt, view.policy)?.toISOString() ?? null) : null,
  };
}

function presentEvents(rows: EventRows, view: View): DeskEvent[] {
  const events: DeskEvent[] = [
    ...rows.sessions.map((session) => ({
      id: session.id,
      kind: 'TRAINING' as const,
      title: session.trainingType.name,
      startsAt: session.startsAt.toISOString(),
      endsAt: session.endsAt.toISOString(),
      price: session.trainingType.price,
      capacity: session.capacity,
      coachName: session.coach.membership.user.fullName,
      participants: session.bookings.map((row) => participant(row, view)),
      ...timing(session, session.bookings.some(isUnmarked), view),
    })),
    ...rows.tournaments.map((tournament) => ({
      id: tournament.id,
      kind: 'TOURNAMENT' as const,
      title: tournament.tournamentType.name,
      startsAt: tournament.startsAt.toISOString(),
      endsAt: tournament.endsAt.toISOString(),
      price: tournament.tournamentType.price,
      // Лимита мест у турнира нет вовсе — число записавшихся справочно.
      capacity: null,
      coachName: null,
      participants: tournament.registrations.map((row) => participant(row, view)),
      ...timing(tournament, tournament.registrations.some(isUnmarked), view),
    })),
  ];

  return events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
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

const participant = (row: EntryRow, view: View): DeskParticipant => ({
  ...personOf(row.client),
  entryId: row.id,
  status: row.status,
  chargePercent: row.chargeRatio,
  mark: view.marks.get(row.id) ?? null,
});

/** Запись, всё ещё ждущая отметки. */
function isUnmarked(row: { status: BookingStatus }): boolean {
  return row.status === BookingStatus.BOOKED;
}

/** Идентификаторы отмеченных записей — только у них есть что спросить у журнала. */
function markedIds(rows: readonly { id: string; status: BookingStatus }[]): string[] {
  return rows
    .filter((row) => row.status === BookingStatus.ATTENDED || row.status === BookingStatus.NO_SHOW)
    .map((row) => row.id);
}

function uniqueById<T extends { id: string }>(rows: readonly T[]): T[] {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

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
