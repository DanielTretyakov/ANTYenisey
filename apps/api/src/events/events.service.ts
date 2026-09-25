import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, Prisma } from '@yenisey/database';
import type { BookingEntry, ClubCatalogItem, ClubEvent, EventDetail, EventKind } from '@yenisey/types';
import { cancellationOpen, cancellationPercent } from '../booking/availability';
import {
  catalogItem,
  TOURNAMENT_DETAIL_SELECT,
  TOURNAMENT_EVENT_SELECT,
  TRAINING_DETAIL_SELECT,
  TRAINING_EVENT_SELECT,
  tournamentDetail,
  tournamentEvent,
  trainingDetail,
  trainingEvent,
} from './event-view';
import { MembershipService } from '../club/membership.service';
import { ClientNotifier } from '../notifications/client-notifier.service';
import { StaffNotifier } from '../notifications/staff-notifier.service';
import { EntriesService } from '../entries/entries.service';
import { PrismaService } from '../prisma/prisma.service';
import { consumed, subscriptionCancelRatio } from '../subscriptions/subscription-rules';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

/**
 * Мероприятия клуба и запись на них: занятия и турниры одним списком.
 *
 * Аренда стола мероприятием НЕ считается и в открытый список не попадает (ТЗ →
 * «Страница клуба»): к чужой броне стола нельзя присоединиться, и публичный
 * список из неё состоял бы из строк, на которые невозможно записаться. В «мои»
 * она при этом входит — это часть расписания человека.
 *
 * Занятие и турнир похожи ровно настолько, чтобы их хотелось объединить, и
 * различаются в одном месте по существу: у занятия есть лимит мест. Из-за него
 * запись на занятие — не такая же операция, как регистрация на турнир: её
 * приходится сериализовать блокировкой строки, см. `registerForTraining`.
 */
/** Самое широкое окно списка: месяц с запасом — неделя страницы клуба и ещё три. */
const MAX_RANGE_MS = 31 * 24 * 3600_000;

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entries: EntriesService,
    private readonly membership: MembershipService,
    private readonly subscriptions: SubscriptionsService,
    private readonly notifier: ClientNotifier,
    private readonly staff: StaffNotifier,
  ) {}

  /**
   * Предстоящие мероприятия клуба — открытая запись.
   *
   * `userId` пустой, когда спрашивает аноним: список открыт без входа, клуб
   * выбирают до регистрации. Тогда `registered` остаётся `null` — отвечать
   * «не записан» тому, кто просто не представился, значило бы показать ему
   * кнопку записи, ведущую на форму входа.
   */
  async listUpcoming(
    tenantId: string,
    userId: string | null,
    range: { from?: string; to?: string; kind?: EventKind; typeId?: string; limit?: number } = {},
  ): Promise<ClubEvent[]> {
    const now = new Date();
    const from = range.from && new Date(range.from) > now ? new Date(range.from) : now;
    const to = range.to ? new Date(range.to) : undefined;

    if (to && to.getTime() - from.getTime() > MAX_RANGE_MS) {
      throw new BadRequestException('Окно списка — не больше 31 дня');
    }

    if (range.typeId && !range.kind) {
      throw new BadRequestException('Тип мероприятия указывается вместе с видом: kind=TRAINING или TOURNAMENT');
    }

    const startsAt = { gte: from, ...(to ? { lt: to } : {}) };
    // Вид отсекает вторую таблицу целиком: «только детские тренировки» не
    // должны тянуть турниры, чтобы потом их выбросить.
    const take = range.limit;

    const [tournaments, sessions] = await Promise.all([
      range.kind === 'TRAINING'
        ? []
        : this.prisma.tournament.findMany({
            where: { tenantId, startsAt, ...(range.typeId ? { tournamentTypeId: range.typeId } : {}) },
            select: TOURNAMENT_EVENT_SELECT,
            orderBy: { startsAt: 'asc' },
            take,
          }),
      range.kind === 'TOURNAMENT'
        ? []
        : this.prisma.trainingSession.findMany({
            where: { tenantId, startsAt, ...(range.typeId ? { trainingTypeId: range.typeId } : {}) },
            select: TRAINING_EVENT_SELECT,
            orderBy: { startsAt: 'asc' },
            take,
          }),
    ]);

    // Чем оплатит запись тот, за кого действуют: абонементом или по цене.
    // Одним запросом на весь список — это подсказка у кнопки, а не обещание.
    const payWith = userId
      ? await this.subscriptions.payWithFor(tenantId, userId, [
          ...tournaments.map((row) => ({
            id: row.id,
            kind: 'TOURNAMENT' as const,
            typeId: row.tournamentTypeId,
            startsAt: row.startsAt,
          })),
          ...sessions.map((row) => ({
            id: row.id,
            kind: 'TRAINING' as const,
            typeId: row.trainingTypeId,
            startsAt: row.startsAt,
          })),
        ])
      : new Map();

    const events: ClubEvent[] = [
      ...tournaments.map((row) => tournamentEvent(row, userId)),
      ...sessions.map((row) => trainingEvent(row, userId)),
    ].map((event) => ({ ...event, payWith: payWith.get(event.id) ?? null }));

    // Общая сортировка по времени: человек смотрит на неделю клуба целиком, а
    // не отдельно на занятия и отдельно на турниры. Предел — после слияния:
    // каждая таблица отдала до N своих, ближайшие N общих — среди них.
    const sorted = events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

    return take ? sorted.slice(0, take) : sorted;
  }

  /**
   * Что вообще есть в клубе — вкладка «Мероприятия клуба» (решение владельца
   * от 25.09.2026): действующие типы занятий и турниров с ближайшим
   * проведением. Открыто, как и список: это витрина клуба.
   */
  async catalog(tenantId: string): Promise<ClubCatalogItem[]> {
    const now = new Date();
    const [trainingTypes, tournamentTypes, trainingNext, tournamentNext] = await Promise.all([
      this.prisma.trainingType.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, name: true, description: true, price: true },
      }),
      this.prisma.tournamentType.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, name: true, description: true, price: true, ratingLabel: true },
      }),
      this.prisma.trainingSession.groupBy({
        by: ['trainingTypeId'],
        where: { tenantId, startsAt: { gte: now } },
        _min: { startsAt: true },
        _count: { _all: true },
      }),
      this.prisma.tournament.groupBy({
        by: ['tournamentTypeId'],
        where: { tenantId, startsAt: { gte: now } },
        _min: { startsAt: true },
        _count: { _all: true },
      }),
    ]);

    const trainingByType = new Map(
      trainingNext.map((row) => [row.trainingTypeId, { startsAt: row._min.startsAt, count: row._count._all }]),
    );
    const tournamentByType = new Map(
      tournamentNext.map((row) => [row.tournamentTypeId, { startsAt: row._min.startsAt, count: row._count._all }]),
    );

    // Сначала то, что скоро будет, потом — без проведений впереди, по имени:
    // «что есть в клубе» читается от того, куда можно пойти на этой неделе.
    return [
      ...trainingTypes.map((type) => catalogItem('TRAINING', type, trainingByType.get(type.id))),
      ...tournamentTypes.map((type) => catalogItem('TOURNAMENT', type, tournamentByType.get(type.id))),
    ].sort(
      (a, b) =>
        (a.nextStartsAt ?? '\uffff').localeCompare(b.nextStartsAt ?? '\uffff') || a.name.localeCompare(b.name, 'ru'),
    );
  }

  /**
   * Одно мероприятие для окна подробностей — открыто, как и список.
   *
   * Прошедшее тоже отдаётся: окно открывают и из «Моих записей», и по ссылке,
   * присланной накануне. Записаться на него всё равно нельзя — это решают
   * маршруты записи, а не окно.
   */
  async detail(tenantId: string, kind: EventKind, id: string, userId: string | null): Promise<EventDetail> {
    const today = new Date();
    let event: EventDetail;
    let typeId: string;

    if (kind === 'TOURNAMENT') {
      const row = await this.prisma.tournament.findFirst({
        where: { id, tenantId },
        select: TOURNAMENT_DETAIL_SELECT,
      });

      if (!row) throw new NotFoundException('Турнир не найден');

      event = tournamentDetail(row, userId, today);
      typeId = row.tournamentTypeId;
    } else {
      const row = await this.prisma.trainingSession.findFirst({
        where: { id, tenantId },
        select: TRAINING_DETAIL_SELECT,
      });

      if (!row) throw new NotFoundException('Занятие не найдено');

      event = trainingDetail(row, userId, today);
      typeId = row.trainingTypeId;
    }

    const payWith = userId
      ? await this.subscriptions.payWithFor(tenantId, userId, [
          { id: event.id, kind, typeId, startsAt: new Date(event.startsAt) },
        ])
      : new Map();

    return { ...event, payWith: payWith.get(event.id) ?? null };
  }

  /** Мои мероприятия в этом клубе: записи на занятия, турниры и свои брони столов. */
  listMine(tenantId: string, userId: string): Promise<BookingEntry[]> {
    return this.entries.listForUser(userId, tenantId);
  }

  /**
   * Запись на турнир.
   *
   * Вступать в клуб заранее не нужно: записаться может любой пользователь
   * платформы, а привязка и анкета клиента заводятся первым же действием — тем
   * же приёмом, что и при первой броне стола.
   *
   * Лимита мест у турнира нет: в схеме `Tournament` несёт только дату и тип, и
   * ТЗ ограничения не требует. Число записавшихся показывается справочно.
   */
  async register(tenantId: string, userId: string, tournamentId: string): Promise<BookingEntry> {
    const tournament = await this.prisma.tournament.findFirst({
      where: { id: tournamentId, tenantId },
      select: {
        id: true,
        startsAt: true,
        tournamentTypeId: true,
        tournamentType: { select: { price: true, isActive: true } },
      },
    });

    if (!tournament) {
      throw new NotFoundException('Турнир не найден');
    }

    if (tournament.startsAt.getTime() <= Date.now()) {
      throw new BadRequestException('Этот турнир уже начался');
    }

    if (!tournament.tournamentType.isActive) {
      throw new BadRequestException('Запись на этот турнир закрыта');
    }

    await this.membership.ensureClient(tenantId, userId);

    let entryId: string;

    try {
      // Транзакция — ради абонемента: запись и списание визита либо вместе,
      // либо никак. Повторная запись (P2002) откатывает и списание.
      entryId = await this.prisma.$transaction(async (tx) => {
        const sub = await this.subscriptions.reserveInTx(tx, tenantId, userId, {
          kind: 'TOURNAMENT',
          typeId: tournament.tournamentTypeId,
          startsAt: tournament.startsAt,
        });

        const created = await tx.tournamentRegistration.create({
          select: { id: true },
          data: {
            tenantId,
            tournamentId: tournament.id,
            clientId: userId,
            // Копия цены на момент записи: поднятый через месяц прайс не должен
            // переписывать то, о чём клуб уже договорился с человеком. Пишется
            // и при оплате абонементом — иначе стоимость визита не восстановить.
            priceAtBooking: tournament.tournamentType.price,
            subscriptionId: sub?.id ?? null,
          },
        });

        if (sub) {
          await this.subscriptions.chargeInTx(tx, tenantId, sub, { tournamentRegistrationId: created.id });
        }

        await this.notifier.entryBooked(tx, tenantId, 'TOURNAMENT', created.id, 'self');

        return created.id;
      });
    } catch (error) {
      // Повторную запись ловит частичный уникальный индекс из constraints.sql.
      // Частичный он намеренно: записаться заново после собственной отмены —
      // законный сценарий, и обычный UNIQUE его бы запретил.
      //
      // Ловим по КОДУ, а не по имени индекса. Prisma индексов, заведённых
      // сырым SQL, не знает и отдаёт «Unique constraint failed on the (not
      // available)» — имени в тексте нет вовсе, и проверка по нему молча
      // пропускала бы ошибку наружу пятисоткой. Приём из BookingService (там
      // ищется имя exclusion-констрейнта) здесь не работает именно поэтому.
      //
      // Код достаточно точен: на вставке регистрации других уникальных
      // ограничений нет — первичный ключ генерируется cuid'ом.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Вы уже записаны на этот турнир');
      }

      throw error;
    }

    return this.entryFor(tenantId, userId, entryId);
  }

  /**
   * Запись на занятие.
   *
   * Отличается от турнира одним — лимитом мест, и именно из-за него запись
   * идёт транзакцией с блокировкой строки сессии. Проверка «занято меньше, чем
   * мест» в коде без блокировки не работает: два параллельных запроса оба
   * прочитают «занято 9 из 10» и оба вставят запись. Констрейнтом это тоже не
   * выражается — проверка требует подсчёта строк в другой таблице, — поэтому
   * рецепт с `FOR UPDATE` записан прямо в constraints.sql (раздел 4), и здесь
   * ровно он.
   *
   * `SELECT ... FOR UPDATE` держит блокировку до конца транзакции, так что
   * вторая запись ждёт первую и видит уже обновлённое число занятых мест.
   */
  async registerForTraining(
    tenantId: string,
    userId: string,
    sessionId: string,
  ): Promise<BookingEntry> {
    const session = await this.prisma.trainingSession.findFirst({
      where: { id: sessionId, tenantId },
      select: {
        id: true,
        startsAt: true,
        trainingTypeId: true,
        trainingType: { select: { price: true, isActive: true } },
      },
    });

    if (!session) {
      throw new NotFoundException('Занятие не найдено');
    }

    if (session.startsAt.getTime() <= Date.now()) {
      throw new BadRequestException('Это занятие уже началось');
    }

    if (!session.trainingType.isActive) {
      throw new BadRequestException('Запись на это занятие закрыта');
    }

    await this.membership.ensureClient(tenantId, userId);

    let entryId: string;

    try {
      entryId = await this.prisma.$transaction(async (tx) => {
        // Блокировка именно строки сессии, а не пересчёт после вставки:
        // откатывать уже созданную запись пришлось бы вручную, и при отказе
        // клиенту досталась бы половина операции.
        const locked = await tx.$queryRaw<{ capacity: number }[]>`
          SELECT "capacity" FROM "TrainingSession" WHERE "id" = ${session.id} FOR UPDATE
        `;

        const capacity = locked[0]?.capacity;

        if (capacity === undefined) {
          throw new NotFoundException('Занятие не найдено');
        }

        const taken = await tx.trainingBooking.count({
          where: { sessionId: session.id, status: BookingStatus.BOOKED },
        });

        if (taken >= capacity) {
          throw new ConflictException('На это занятие мест больше нет');
        }

        // Абонемент — после блокировки занятия: порядок блокировок везде один.
        const sub = await this.subscriptions.reserveInTx(tx, tenantId, userId, {
          kind: 'TRAINING',
          typeId: session.trainingTypeId,
          startsAt: session.startsAt,
        });

        const created = await tx.trainingBooking.create({
          data: {
            tenantId,
            sessionId: session.id,
            clientId: userId,
            // Копия цены на момент записи — по той же причине, что у турнира.
            priceAtBooking: session.trainingType.price,
            subscriptionId: sub?.id ?? null,
          },
          select: { id: true },
        });

        if (sub) {
          await this.subscriptions.chargeInTx(tx, tenantId, sub, { trainingBookingId: created.id });
        }

        await this.notifier.entryBooked(tx, tenantId, 'TRAINING', created.id, 'self');
        await this.staff.trainingChanged(tx, tenantId, created.id, 'BOOKED');

        return created.id;
      });
    } catch (error) {
      // Повторную запись ловит тот же частичный уникальный индекс, что у
      // турнира, и ловится он так же по коду: имени индекса, заведённого сырым
      // SQL, Prisma не знает.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Вы уже записаны на это занятие');
      }

      throw error;
    }

    return this.entryFor(tenantId, userId, entryId);
  }

  /**
   * Отмена записи на турнир.
   *
   * Процент списания фиксируется В МОМЕНТ отмены, а не считается при показе:
   * политика клуба может измениться завтра, и тогда уже закрытая запись задним
   * числом сменила бы условия. Та же механика и те же ступени, что у брони
   * стола, — иначе два способа отмены разошлись бы в деньгах.
   *
   * Ищется только живая запись. Раньше фильтра статуса не было, и после
   * «отменил и записался снова» находилась старая отменённая строка — отмена
   * живой записи отвечала «уже нельзя отменить».
   */
  async cancel(tenantId: string, userId: string, tournamentId: string): Promise<BookingEntry> {
    const registration = await this.prisma.tournamentRegistration.findFirst({
      where: { tenantId, tournamentId, clientId: userId, status: BookingStatus.BOOKED },
      select: { id: true, subscriptionId: true, tournament: { select: { startsAt: true } } },
    });

    if (!registration) {
      throw new NotFoundException('Запись не найдена');
    }

    if (!cancellationOpen(registration.tournament.startsAt, new Date())) {
      throw new BadRequestException('Турнир уже начался — отменить запись нельзя');
    }

    await this.prisma.$transaction(async (tx) => {
      const ratio = await this.cancelRatio(tx, tenantId, registration.tournament.startsAt, registration.subscriptionId);

      await this.cancelEntry(
        tx.tournamentRegistration.updateMany({
          where: { id: registration.id, status: BookingStatus.BOOKED },
          data: { status: BookingStatus.CANCELLED, cancelledAt: new Date(), chargeRatio: ratio },
        }),
      );

      if (registration.subscriptionId) {
        await this.subscriptions.settleInTx(
          tx,
          tenantId,
          registration.subscriptionId,
          true,
          consumed({ status: 'CANCELLED', chargeRatio: ratio }),
          { tournamentRegistrationId: registration.id },
        );
      }

      await this.notifier.entryCancelled(tx, tenantId, 'TOURNAMENT', registration.id, 'self');
    });

    return this.entryFor(tenantId, userId, registration.id);
  }

  /**
   * Отмена записи на занятие.
   *
   * Слово в слово та же механика, что у турнира: политика отмены в ТЗ единая
   * для тренировок, турниров и аренды стола, и разойтись этим трём способам
   * отмены в деньгах нельзя.
   */
  async cancelTraining(
    tenantId: string,
    userId: string,
    sessionId: string,
  ): Promise<BookingEntry> {
    const booking = await this.prisma.trainingBooking.findFirst({
      where: { tenantId, sessionId, clientId: userId, status: BookingStatus.BOOKED },
      select: { id: true, subscriptionId: true, session: { select: { startsAt: true } } },
    });

    if (!booking) {
      // Отменённая запись сюда не попадает по фильтру статуса: искать её
      // отдельно, чтобы ответить «уже нельзя отменить», незачем — человек с
      // отменённой записью и так видит её отменённой.
      throw new NotFoundException('Запись не найдена');
    }

    if (!cancellationOpen(booking.session.startsAt, new Date())) {
      throw new BadRequestException('Занятие уже началось — отменить запись нельзя');
    }

    await this.prisma.$transaction(async (tx) => {
      const ratio = await this.cancelRatio(tx, tenantId, booking.session.startsAt, booking.subscriptionId);

      await this.cancelEntry(
        tx.trainingBooking.updateMany({
          where: { id: booking.id, status: BookingStatus.BOOKED },
          data: { status: BookingStatus.CANCELLED, cancelledAt: new Date(), chargeRatio: ratio },
        }),
      );

      if (booking.subscriptionId) {
        await this.subscriptions.settleInTx(
          tx,
          tenantId,
          booking.subscriptionId,
          true,
          consumed({ status: 'CANCELLED', chargeRatio: ratio }),
          { trainingBookingId: booking.id },
        );
      }

      await this.notifier.entryCancelled(tx, tenantId, 'TRAINING', booking.id, 'self');
      await this.staff.trainingChanged(tx, tenantId, booking.id, 'CANCELLED');
    });

    return this.entryFor(tenantId, userId, booking.id);
  }

  /**
   * Отмена условным обновлением — `WHERE status = 'BOOKED'`.
   *
   * Между чтением записи и записью отмены её могли отменить во второй вкладке
   * или отметить: обновление по одному `id` записало бы отмену поверх, и
   * процент лёг бы вторым, другим. Условие на статус превращает гонку в
   * внятный отказ.
   */
  private async cancelEntry(update: Promise<{ count: number }>): Promise<void> {
    if ((await update).count === 0) {
      throw new ConflictException('Запись уже изменилась — обновите страницу');
    }
  }

  /**
   * Процент списания по политике клуба на момент отмены.
   *
   * Считается СЕЙЧАС и записывается в строку: политика клуба может измениться
   * завтра, и тогда уже закрытая запись задним числом сменила бы условия.
   */
  private async chargeFor(tx: Prisma.TransactionClient, tenantId: string, startsAt: Date): Promise<number> {
    const tiers = await tx.cancellationTier.findMany({
      where: { tenantId },
      select: { minMinutesBeforeStart: true, chargePercent: true },
    });

    return cancellationPercent(tiers, Math.floor((startsAt.getTime() - Date.now()) / 60_000));
  }

  /**
   * Процент отмены. У записи по абонементу он означает судьбу визита, а не
   * долю цены: при мягком правиле клуба визит возвращается всегда, при
   * строгом — сгорает целиком, если ступень политики назначила хоть что-то.
   */
  private async cancelRatio(
    tx: Prisma.TransactionClient,
    tenantId: string,
    startsAt: Date,
    subscriptionId: string | null,
  ): Promise<number> {
    const percent = await this.chargeFor(tx, tenantId, startsAt);

    if (!subscriptionId) {
      return percent;
    }

    return subscriptionCancelRatio(await this.subscriptions.softRule(tx, tenantId), percent);
  }

  /**
   * Запись в том виде, в каком её показывает интерфейс.
   *
   * Собирается тем же сервисом, что и раздел «Мои записи»: если бы ответ на
   * запись строился здесь отдельно, строка после нажатия кнопки выглядела бы
   * не так, как та же строка в списке.
   */
  private async entryFor(
    tenantId: string,
    userId: string,
    entryId: string,
  ): Promise<BookingEntry> {
    // По строке записи, а не по мероприятию: после «отменил и записался снова»
    // у одного занятия две строки, и поиск по занятию мог вернуть старую.
    const entries = await this.entries.listForUser(userId, tenantId);
    const entry = entries.find((row) => row.entryId === entryId);

    if (!entry) {
      throw new NotFoundException('Запись не найдена');
    }

    return entry;
  }
}
