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
  type ClientBooking,
  type CreateBookingRequest,
} from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';
import { localParts } from '../club/closures';
import { MembershipService } from '../club/membership.service';
import { ClientNotifier } from '../notifications/client-notifier.service';
import {
  bookingViolation,
  cancellationOpen,
  cancellationPercent,
  CLOSE_MINUTE,
  mergeBusy,
  OPEN_MINUTE,
  STEP_MINUTES,
} from './availability';
import { assertDateFormat, OccupancyService } from './occupancy.service';
import { quote } from './pricing';

/**
 * Что нужно от зала, чтобы посчитать цену и проверить заявку.
 *
 * Экспортируется: рабочее место администратора считает цену ручной брони тем
 * же `quote()` и по тем же полям. Второй набор колонок разошёлся бы с этим на
 * первой же правке прайса.
 */
export const HALL_PRICING = {
  id: true,
  name: true,
  // Часовой пояс едет вместе с ценами намеренно: и то, и другое — свойство
  // ЗАЛА, и оба нужны в одних и тех же местах. Раньше пояс приходил отдельным
  // запросом к клубу, и зал в другом регионе тарифицировался бы по чужим
  // границам суток.
  timezone: true,
  bookingStep: true,
  tableHourPrice: true,
  tableExtra30MinPrice: true,
  hasRobotOption: true,
  robot30MinPrice: true,
  robot60MinPrice: true,
  robotExtra30MinPrice: true,
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
  isSparring: true,
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
  isSparring: boolean;
  table: { label: string; hallId: string; hall: { name: string } };
}

type Tier = { minMinutesBeforeStart: number; chargePercent: number };

/**
 * Кто стоит за бронью.
 *
 * Их ровно двое, и это не «роль», а владелец строки: у клиента заполнен
 * `clientId`, у тренера — `coachId` с пометкой спарринга. Заполнено всегда
 * одно из двух — это держит CHECK `TableBooking_client_xor_coach`.
 */
export type BookingOwner = { kind: 'client' | 'coach'; userId: string };

/** Условие «эта бронь принадлежит ему» — одно на чтение, отмену и список. */
function ownedBy(owner: BookingOwner) {
  return owner.kind === 'client' ? { clientId: owner.userId } : { coachId: owner.userId };
}

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly occupancy: OccupancyService,
    private readonly membership: MembershipService,
    private readonly notifier: ClientNotifier,
  ) {}

  /**
   * Что свободно в зале на дату.
   *
   * Клиенту отдаётся только «занято», без причины: расписание клуба — его
   * внутренняя кухня, а для выбора времени достаточно знать, что стол занят.
   */
  async findDay(tenantId: string, hallId: string, date: string): Promise<BookingDay> {
    assertDateFormat(date);

    const hall = await this.hall(tenantId, hallId);
    // Пояс ЗАЛА, а не клуба: «сегодня» и границы суток у зала в другом
    // регионе свои, и считать их по часам головного клуба значит показать
    // клиенту не тот день.
    const timezone = hall.timezone;

    this.assertWithinHorizon(date, timezone);

    const tables = await this.prisma.table.findMany({
      where: { tenantId, hallId },
      select: { id: true, label: true },
      orderBy: { label: 'asc' },
    });

    const busyByTable = await this.occupancy.busyByTable(
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
    owner: BookingOwner,
    dto: CreateBookingRequest,
  ): Promise<ClientBooking> {
    const table = await this.prisma.table.findFirst({
      where: { id: dto.tableId, tenantId },
      select: { id: true, hallId: true, hall: { select: HALL_PRICING } },
    });

    if (!table) {
      throw new NotFoundException('Стол не найден');
    }

    // Пояс зала, в котором стоит стол. Он приезжает вместе с ценами одним
    // запросом — отдельного похода к клубу больше нет.
    const timezone = table.hall.timezone;

    const startsAt = parseInstant(dto.startsAt);
    const start = localParts(startsAt, timezone);

    this.assertWithinHorizon(start.date, timezone);

    if (dto.withRobot && !table.hall.hasRobotOption) {
      throw new BadRequestException('В этом зале нет аренды с роботом');
    }

    const busy = await this.occupancy.busyByTable(tenantId, table.hallId, start.date, timezone, [
      table.id,
    ]);

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

    if (owner.kind === 'client') {
      // Привязка к клубу заводится здесь, перед первой бронью. По ТЗ
      // записаться может любой пользователь платформы, вступать в клуб не нужно, —
      // но бронь ссылается на ClientProfile, а тот — на TenantMembership. Без
      // этого шага первая же бронь новичка падала бы ошибкой внешнего ключа.
      await this.membership.ensureClient(tenantId, owner.userId);
    } else {
      // Тренер в клубе уже состоит — иначе ClubContextGuard не дал бы ему сюда
      // войти, — но карточки у него может не быть: её заводит смена роли, а
      // роли выдавались и до того, как карточка появилась.
      await this.assertCoach(tenantId, owner.userId);
    }

    let created: BookingRow;

    try {
      // Транзакция — ради подтверждения в MAX: бронь и сообщение о ней либо
      // вместе, либо никак. У спарринга клиента нет, и сообщать некому.
      created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.tableBooking.create({
          data: {
            tenantId,
            tableId: table.id,
            ...(owner.kind === 'client'
              ? { clientId: owner.userId }
              : { coachId: owner.userId, isSparring: true }),
            withRobot: dto.withRobot,
            startsAt,
            endsAt,
            // Копия цены на момент брони: поднятый через месяц прайс не должен
            // переписывать то, о чём клуб уже договорился с клиентом.
            priceAtBooking: price,
          },
          select: BOOKING_SELECT,
        });

        await this.notifier.entryBooked(tx, tenantId, 'TABLE', row.id, 'self');

        return row;
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

  /** Свои брони: свежие сверху. У тренера это его спарринги. */
  async listMine(tenantId: string, owner: BookingOwner): Promise<ClientBooking[]> {
    const bookings = await this.prisma.tableBooking.findMany({
      where: { tenantId, ...ownedBy(owner) },
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
   *
   * После начала бронь не отменяется: пропустивший игру отменял бы её задним
   * числом и платил позднюю отмену по ступеням политики вместо неявки. После
   * начала бронь только отмечается — присутствием или неявкой.
   */
  async cancel(tenantId: string, owner: BookingOwner, bookingId: string): Promise<ClientBooking> {
    const booking = await this.prisma.tableBooking.findFirst({
      where: { id: bookingId, tenantId, ...ownedBy(owner) },
      select: BOOKING_SELECT,
    });

    if (!booking) {
      throw new NotFoundException('Бронь не найдена');
    }

    if (booking.status !== BookingStatus.BOOKED) {
      throw new BadRequestException('Эту бронь уже нельзя отменить');
    }

    if (!cancellationOpen(booking.startsAt, new Date())) {
      throw new BadRequestException('Бронь уже началась — отменить её нельзя');
    }

    const tiers = await this.tiers(tenantId);
    const percent = cancelPercentOf(booking, tiers);

    // Условие на статус — против гонки: вторая вкладка отменила бронь, пока
    // эта читала её живой, — и процент записался бы дважды, вторым поверх.
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.tableBooking.updateMany({
        where: { id: bookingId, status: BookingStatus.BOOKED },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt: new Date(),
          chargeRatio: percent,
        },
      });

      if (count === 0) {
        throw new ConflictException('Бронь уже изменилась — обновите страницу');
      }

      await this.notifier.entryCancelled(tx, tenantId, 'TABLE', bookingId, 'self');
    });

    const cancelled = await this.prisma.tableBooking.findUniqueOrThrow({
      where: { id: bookingId },
      select: BOOKING_SELECT,
    });

    return this.present(cancelled, tiers);
  }

  // --- Внутреннее ----------------------------------------------------------

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
        booking.status === BookingStatus.BOOKED ? cancelPercentOf(booking, tiers) : null,
    };
  }

  private tiers(tenantId: string): Promise<Tier[]> {
    return this.prisma.cancellationTier.findMany({
      where: { tenantId },
      select: { minMinutesBeforeStart: true, chargePercent: true },
    });
  }

  private async assertCoach(tenantId: string, coachId: string): Promise<void> {
    const coach = await this.prisma.coachProfile.findUnique({
      where: { userId_tenantId: { userId: coachId, tenantId } },
      select: { userId: true },
    });

    if (!coach) {
      throw new NotFoundException('Карточка тренера не найдена');
    }
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

/**
 * Сколько списать при отмене этой брони.
 *
 * У спарринга — ничего: заблаговременная отмена тренеру бесплатна (решение
 * владельца от 20.09.2026). Деньги с него клуб берёт только за неявку, и берёт
 * целиком — это делает отметка присутствия, а не отмена.
 */
function cancelPercentOf(booking: Pick<BookingRow, 'isSparring' | 'startsAt'>, tiers: readonly Tier[]): number {
  return booking.isSparring ? 0 : cancellationPercent(tiers, minutesUntil(booking.startsAt));
}
