import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, BookingSource, BookingStatus, Prisma } from '@yenisey/database';
import { isStaff, type BookingEntry, type ClubCatalogItem, type ClubEvent, type EventDetail, type EventKind } from '@yenisey/types';
import { cancellationOpen, cancellationPercent } from '../booking/availability';
import {
  catalogItem,
  TOURNAMENT_DETAIL_SELECT,
  TOURNAMENT_EVENT_SELECT,
  TRAINING_DETAIL_SELECT,
  TRAINING_EVENT_SELECT,
  CLUB_ZONE_SELECT,
  eventZone,
  HALL_NAME_SELECT,
  TYPE_HALLS_SELECT,
  tournamentDetail,
  tournamentEvent,
  trainingDetail,
  trainingEvent,
} from './event-view';
import { AttendanceService, type Actor } from '../attendance/attendance.service';
import { MembershipService } from '../club/membership.service';
import { ClientNotifier } from '../notifications/client-notifier.service';
import { StaffNotifier } from '../notifications/staff-notifier.service';
import { EntriesService } from '../entries/entries.service';
import { PrismaService } from '../prisma/prisma.service';
import { consumed, subscriptionCancelRatio } from '../subscriptions/subscription-rules';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { clubTimezone } from '../notifications/clock';
import { localParts } from '../club/closures';
import { staffJoinProblem } from '../staff/shift-rules';
import { StaffService } from '../staff/staff.service';

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
 * приходится сериализовать блокировкой строки, см. `enroll`.
 */
/** Самое широкое окно списка: месяц с запасом — неделя страницы клуба и ещё три. */
const MAX_RANGE_MS = 31 * 24 * 3600_000;

/** Отказ записи на отменённое клубом (решение владельца от 10.10.2026). */
const CANCELLED_TRAINING = 'Клуб отменил это занятие — записаться на него нельзя';
const CANCELLED_TOURNAMENT = 'Клуб отменил этот турнир — записаться на него нельзя';

/**
 * Мероприятия в залах страницы клуба (решение владельца от 25.09.2026):
 * мероприятие — в зале, если стоит в его расписании; без окна в сетке — там,
 * где идёт его вид (пусто — во всех залах).
 *
 * Одно правило на список «Предстоящих» и на «Ближайшее» у вида: разойдись
 * они, карточка вида и список под ней называли бы разные проведения.
 */
function hallScope(value: string | undefined): {
  training: Prisma.TrainingSessionWhereInput;
  tournament: Prisma.TournamentWhereInput;
} {
  const halls = value ? value.split(',').filter(Boolean) : null;

  if (!halls) {
    return { training: {}, tournament: {} };
  }

  const typeInHalls = { OR: [{ halls: { none: {} } }, { halls: { some: { hallId: { in: halls } } } }] };
  const placedInHalls = { some: { table: { hallId: { in: halls } } } };

  return {
    training: { OR: [{ dayClosures: placedInHalls }, { dayClosures: { none: {} }, trainingType: typeInHalls }] },
    tournament: { OR: [{ dayClosures: placedInHalls }, { dayClosures: { none: {} }, tournamentType: typeInHalls }] },
  };
}

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entries: EntriesService,
    private readonly membership: MembershipService,
    private readonly subscriptions: SubscriptionsService,
    private readonly notifier: ClientNotifier,
    private readonly staffNotifier: StaffNotifier,
    private readonly staff: StaffService,
    private readonly attendance: AttendanceService,
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
    range: { from?: string; to?: string; kind?: EventKind; typeId?: string; limit?: number; halls?: string } = {},
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
    const inHalls = hallScope(range.halls);
    // Вид отсекает вторую таблицу целиком: «только детские тренировки» не
    // должны тянуть турниры, чтобы потом их выбросить.
    const take = range.limit;

    const [tournaments, sessions] = await Promise.all([
      range.kind === 'TRAINING'
        ? []
        : this.prisma.tournament.findMany({
            where: {
              tenantId,
              startsAt,
              // Отменённое клубом из открытых списков уходит (10.10.2026); его
              // показывают «Мои записи» и окно мероприятия — по ссылке.
              cancelledAt: null,
              ...(range.typeId ? { tournamentTypeId: range.typeId } : {}),
              ...inHalls.tournament,
            },
            select: TOURNAMENT_EVENT_SELECT,
            orderBy: { startsAt: 'asc' },
            take,
          }),
      range.kind === 'TOURNAMENT'
        ? []
        : this.prisma.trainingSession.findMany({
            where: {
              tenantId,
              startsAt,
              cancelledAt: null,
              ...(range.typeId ? { trainingTypeId: range.typeId } : {}),
              ...inHalls.training,
            },
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

    // Зал у каждой строки: мероприятие без сетки и без единственного зала вида
    // в клубе с одним залом — там же, где всё остальное.
    if (events.some((event) => event.hall === null)) {
      const clubHalls = await this.prisma.hall.findMany({ where: { tenantId }, select: { name: true }, take: 2 });

      if (clubHalls.length === 1) {
        for (const event of events) event.hall ??= clubHalls[0]!.name;
      }
    }

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
  async catalog(tenantId: string, halls?: string): Promise<ClubCatalogItem[]> {
    const now = new Date();
    // «Ближайшее» у вида — в выбранных залах, тем же правилом, что «Предстоящие»
    // под ним: иначе карточка в «Пирогах» звала бы на занятие в «Баках».
    const inHalls = hallScope(halls);
    // Ближайшее проведение каждого вида — ради пояса его зала: время в
    // карточке показывается по часам зала, как в сетке и в сообщениях.
    const zoneSelect = { dayClosures: HALL_NAME_SELECT } as const;
    const [trainingZones, tournamentZones] = await Promise.all([
      this.prisma.trainingSession.findMany({
        where: { tenantId, startsAt: { gte: now }, cancelledAt: null, ...inHalls.training },
        distinct: ['trainingTypeId'],
        orderBy: { startsAt: 'asc' },
        select: {
          ...zoneSelect,
          trainingTypeId: true,
          trainingType: { select: { halls: TYPE_HALLS_SELECT, tenant: CLUB_ZONE_SELECT } },
        },
      }),
      this.prisma.tournament.findMany({
        where: { tenantId, startsAt: { gte: now }, cancelledAt: null, ...inHalls.tournament },
        distinct: ['tournamentTypeId'],
        orderBy: { startsAt: 'asc' },
        select: {
          ...zoneSelect,
          tournamentTypeId: true,
          tournamentType: { select: { halls: TYPE_HALLS_SELECT, tenant: CLUB_ZONE_SELECT } },
        },
      }),
    ]);
    const trainingZone = new Map(trainingZones.map((row) => [row.trainingTypeId, eventZone(row, row.trainingType)]));
    const tournamentZone = new Map(
      tournamentZones.map((row) => [row.tournamentTypeId, eventZone(row, row.tournamentType)]),
    );

    const [trainingTypes, tournamentTypes, trainingNext, tournamentNext] = await Promise.all([
      this.prisma.trainingType.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, name: true, description: true, price: true, halls: { select: { hallId: true } } },
      }),
      this.prisma.tournamentType.findMany({
        where: { tenantId, isActive: true },
        select: {
          id: true,
          name: true,
          description: true,
          price: true,
          ratingLabel: true,
          halls: { select: { hallId: true } },
        },
      }),
      this.prisma.trainingSession.groupBy({
        by: ['trainingTypeId'],
        where: { tenantId, startsAt: { gte: now }, cancelledAt: null, ...inHalls.training },
        _min: { startsAt: true },
        _count: { _all: true },
      }),
      this.prisma.tournament.groupBy({
        by: ['tournamentTypeId'],
        where: { tenantId, startsAt: { gte: now }, cancelledAt: null, ...inHalls.tournament },
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
      ...trainingTypes.map((type) =>
        catalogItem('TRAINING', type, trainingByType.get(type.id), trainingZone.get(type.id) ?? null),
      ),
      ...tournamentTypes.map((type) =>
        catalogItem('TOURNAMENT', type, tournamentByType.get(type.id), tournamentZone.get(type.id) ?? null),
      ),
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
   * Запись на турнир — сам человек (или родитель за ребёнка).
   *
   * Вступать в клуб заранее не нужно: записаться может любой пользователь
   * платформы, а привязка и анкета клиента заводятся первым же действием — тем
   * же приёмом, что и при первой броне стола.
   *
   * Лимита мест у турнира нет: в схеме `Tournament` несёт только дату и тип, и
   * ТЗ ограничения не требует. Число записавшихся показывается справочно.
   */
  async register(tenantId: string, userId: string, tournamentId: string): Promise<BookingEntry> {
    const entryId = await this.enroll(tenantId, userId, 'TOURNAMENT', tournamentId, null);

    return this.entryFor(tenantId, userId, entryId);
  }

  /** Запись на занятие — сам человек (или родитель за ребёнка). См. `enroll`. */
  async registerForTraining(tenantId: string, userId: string, sessionId: string): Promise<BookingEntry> {
    const entryId = await this.enroll(tenantId, userId, 'TRAINING', sessionId, null);

    return this.entryFor(tenantId, userId, entryId);
  }

  /**
   * Клуб записывает человека на занятие или турнир — звонок «запишите внука
   * на субботу» (решения владельца от 10.10.2026).
   *
   * Тот же путь, что у самозаписи, — лимит мест, замок проведения, абонемент,
   * правила сотрудников, — с двумя отличиями: запись помечена `MANUAL` с
   * автором, а на уже начавшееся записать можно, и такая запись сразу
   * «пришёл»: человек уже в зале, а без отметки её закрыла бы неявкой джоба.
   * Снятый с продажи вид и полная группа клубу не уступают.
   */
  async enrollByClub(
    tenantId: string,
    actor: Actor,
    request: { kind: EventKind; eventId: string; clientId: string },
  ): Promise<BookingEntry> {
    const entryId = await this.enroll(tenantId, request.clientId, request.kind, request.eventId, actor);

    return this.entryFor(tenantId, request.clientId, entryId);
  }

  /**
   * Запись на занятие или турнир — одна на самозапись и на запись клубом.
   *
   * Занятие отличается от турнира лимитом мест, и из-за него запись идёт
   * транзакцией с блокировкой строки сессии. Проверка «занято меньше, чем
   * мест» без блокировки не работает: два параллельных запроса оба прочитают
   * «занято 9 из 10» и оба вставят запись. Констрейнтом это не выражается —
   * рецепт с `FOR UPDATE` записан в constraints.sql (раздел 4), и здесь ровно
   * он. Турнир берёт свою строку `FOR SHARE` — против отмены клубом в ту же
   * секунду: записи друг другу не мешают, а отмена (`FOR UPDATE`) их ждёт.
   * Замок — до абонемента: порядок «проведение → абонемент» везде один.
   */
  private async enroll(
    tenantId: string,
    clientId: string,
    kind: EventKind,
    eventId: string,
    club: Actor | null,
  ): Promise<string> {
    const event = await this.enrollable(tenantId, kind, eventId);
    const now = new Date();
    const started = event.startsAt.getTime() <= now.getTime();
    const cancelled = kind === 'TRAINING' ? CANCELLED_TRAINING : CANCELLED_TOURNAMENT;

    if (event.cancelledAt) {
      throw new BadRequestException(cancelled);
    }

    if (started && !club) {
      throw new BadRequestException(kind === 'TRAINING' ? 'Это занятие уже началось' : 'Этот турнир уже начался');
    }

    if (!event.isActive) {
      throw new BadRequestException(kind === 'TRAINING' ? 'Запись на это занятие закрыта' : 'Запись на этот турнир закрыта');
    }

    await this.assertStaffMayJoin(tenantId, clientId, event.startsAt, event.coachId);
    await this.membership.ensureClient(tenantId, clientId);

    // Политика неявки — для отметки «пришёл» у записи на начавшееся.
    const policy = club && started ? await this.attendance.policy(tenantId) : null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (kind === 'TRAINING') {
          // Блокировка именно строки сессии, а не пересчёт после вставки:
          // откатывать уже созданную запись пришлось бы вручную.
          const locked = await tx.$queryRaw<{ capacity: number; cancelledAt: Date | null }[]>`
            SELECT "capacity", "cancelledAt" FROM "TrainingSession" WHERE "id" = ${event.id} FOR UPDATE
          `;
          const capacity = locked[0]?.capacity;

          if (capacity === undefined) {
            throw new NotFoundException('Занятие не найдено');
          }

          // Клуб мог отменить занятие, пока запрос шёл: замок тот же, что у отмены.
          if (locked[0]?.cancelledAt) {
            throw new BadRequestException(cancelled);
          }

          const taken = await tx.trainingBooking.count({ where: { sessionId: event.id, status: BookingStatus.BOOKED } });

          if (taken >= capacity) {
            throw new ConflictException('На это занятие мест больше нет');
          }
        } else {
          const locked = await tx.$queryRaw<{ cancelledAt: Date | null }[]>`
            SELECT "cancelledAt" FROM "Tournament" WHERE "id" = ${event.id} FOR SHARE
          `;

          if (locked[0]?.cancelledAt) {
            throw new BadRequestException(cancelled);
          }
        }

        const sub = await this.subscriptions.reserveInTx(tx, tenantId, clientId, {
          kind,
          typeId: event.typeId,
          startsAt: event.startsAt,
        });

        // Копия цены на момент записи: поднятый через месяц прайс не должен
        // переписывать то, о чём клуб уже договорился с человеком. Пишется и
        // при оплате абонементом — иначе стоимость визита не восстановить.
        // Ручную запись подписывает сотрудник (CHECK: MANUAL — только с автором).
        const common = {
          tenantId,
          clientId,
          priceAtBooking: event.price,
          subscriptionId: sub?.id ?? null,
          ...(club ? { source: BookingSource.MANUAL, createdByUserId: club.userId } : {}),
        };
        const created =
          kind === 'TRAINING'
            ? await tx.trainingBooking.create({ data: { ...common, sessionId: event.id }, select: { id: true } })
            : await tx.tournamentRegistration.create({ data: { ...common, tournamentId: event.id }, select: { id: true } });

        if (sub) {
          await this.subscriptions.chargeInTx(
            tx,
            tenantId,
            sub,
            kind === 'TRAINING' ? { trainingBookingId: created.id } : { tournamentRegistrationId: created.id },
          );
        }

        // Сначала визит, потом отметка: отметка сверяет журнал с записью.
        if (club && policy) {
          await this.attendance.applyInTx(
            tx,
            tenantId,
            kind,
            created.id,
            { status: 'ATTENDED', reason: 'Записан клубом после начала — человек уже в зале' },
            club,
            { now, noShowChargePercent: policy.noShowChargePercent },
          );
        }

        // Записанному «уже в зале» подтверждать незачем — notifier сам
        // пропустит всё, что не BOOKED.
        await this.notifier.entryBooked(tx, tenantId, kind, created.id, club ? 'club' : 'self');

        if (kind === 'TRAINING') {
          await this.staffNotifier.trainingChanged(tx, tenantId, created.id, 'BOOKED');
        }

        return created.id;
      });
    } catch (error) {
      // Повторную запись ловит частичный уникальный индекс из constraints.sql
      // (частичный — записаться заново после своей отмены законно). Ловим по
      // КОДУ: имени индекса, заведённого сырым SQL, Prisma не знает, и в
      // тексте ошибки его нет. Других уникальных ограничений на вставке нет.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const what = kind === 'TRAINING' ? 'это занятие' : 'этот турнир';

        throw new ConflictException(club ? `Человек уже записан на ${what}` : `Вы уже записаны на ${what}`);
      }

      throw error;
    }
  }

  /** Проведение в том объёме, в каком его судит запись. */
  private async enrollable(
    tenantId: string,
    kind: EventKind,
    id: string,
  ): Promise<{
    id: string;
    startsAt: Date;
    cancelledAt: Date | null;
    typeId: string;
    coachId: string | null;
    price: number;
    isActive: boolean;
  }> {
    if (kind === 'TRAINING') {
      const session = await this.prisma.trainingSession.findFirst({
        where: { id, tenantId },
        select: {
          id: true,
          startsAt: true,
          cancelledAt: true,
          trainingTypeId: true,
          coachId: true,
          trainingType: { select: { price: true, isActive: true } },
        },
      });

      if (!session) throw new NotFoundException('Занятие не найдено');

      return { ...session, typeId: session.trainingTypeId, ...session.trainingType };
    }

    const tournament = await this.prisma.tournament.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        startsAt: true,
        cancelledAt: true,
        tournamentTypeId: true,
        tournamentType: { select: { price: true, isActive: true } },
      },
    });

    if (!tournament) throw new NotFoundException('Турнир не найден');

    return { ...tournament, typeId: tournament.tournamentTypeId, coachId: null, ...tournament.tournamentType };
  }

  /**
   * Клуб отменяет запись человека — по его звонку (решения владельца от
   * 10.10.2026). Деньги — по политике клуба, как если бы отменил он сам, или
   * без списания (`waiveCharge`): «тренер перенёс группу» в политику не
   * заложено. После начала отмены нет и у клуба — дальше отметка.
   */
  async cancelByClub(
    tenantId: string,
    actor: Actor,
    request: { kind: EventKind; entryId: string; waiveCharge: boolean },
  ): Promise<BookingEntry> {
    const { kind, entryId } = request;
    const entry =
      kind === 'TRAINING'
        ? await this.prisma.trainingBooking.findFirst({
            where: { id: entryId, tenantId },
            select: { status: true, clientId: true, subscriptionId: true, session: { select: { startsAt: true } } },
          })
        : await this.prisma.tournamentRegistration.findFirst({
            where: { id: entryId, tenantId },
            select: { status: true, clientId: true, subscriptionId: true, tournament: { select: { startsAt: true } } },
          });

    if (!entry) {
      throw new NotFoundException('Запись не найдена');
    }

    const startsAt = 'session' in entry ? entry.session.startsAt : entry.tournament.startsAt;

    if (entry.status !== BookingStatus.BOOKED) {
      throw new BadRequestException('Эту запись уже нельзя отменить');
    }

    if (!cancellationOpen(startsAt, new Date())) {
      throw new BadRequestException('Уже началось — отметьте присутствие или неявку');
    }

    await this.prisma.$transaction(async (tx) => {
      const ratio = request.waiveCharge ? 0 : await this.cancelRatio(tx, tenantId, startsAt, entry.subscriptionId);
      const where = { id: entryId, status: BookingStatus.BOOKED };
      const data = { status: BookingStatus.CANCELLED, cancelledAt: new Date(), chargeRatio: ratio };

      await this.cancelEntry(
        kind === 'TRAINING' ? tx.trainingBooking.updateMany({ where, data }) : tx.tournamentRegistration.updateMany({ where, data }),
      );

      if (entry.subscriptionId) {
        await this.subscriptions.settleInTx(
          tx,
          tenantId,
          entry.subscriptionId,
          true,
          consumed({ status: 'CANCELLED', chargeRatio: ratio }),
          kind === 'TRAINING' ? { trainingBookingId: entryId } : { tournamentRegistrationId: entryId },
        );
      }

      // За отменой клубом стоят чужие деньги: «кто снял меня с записи» должно
      // иметь ответ.
      await tx.auditLog.create({
        data: {
          tenantId,
          action: AuditAction.BOOKING_CANCELLED,
          actorUserId: actor.userId,
          ipAddress: actor.ipAddress,
          entityType: kind === 'TRAINING' ? 'TrainingBooking' : 'TournamentRegistration',
          entityId: entryId,
          before: { status: BookingStatus.BOOKED },
          after: { status: BookingStatus.CANCELLED, chargeRatio: ratio },
          reason: request.waiveCharge ? 'Клуб отменил запись без списания' : 'Клуб отменил запись по правилам отмены',
        },
      });

      await this.notifier.entryCancelled(tx, tenantId, kind, entryId, 'club');

      if (kind === 'TRAINING') {
        await this.staffNotifier.trainingChanged(tx, tenantId, entryId, 'CANCELLED');
      }
    });

    return this.entryFor(tenantId, entry.clientId, entryId);
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
      await this.staffNotifier.trainingChanged(tx, tenantId, booking.id, 'CANCELLED');
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
  /**
   * Сотрудник записывается на мероприятия своего клуба (решение владельца от
   * 26.09.2026), кроме администратора со сменой в этот день — по местной дате
   * клуба — и тренера на собственное занятие. Правило — `staffJoinProblem`.
   */
  private async assertStaffMayJoin(
    tenantId: string,
    userId: string,
    startsAt: Date,
    coachId: string | null,
  ): Promise<void> {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      select: { roles: true },
    });
    const roles = membership?.roles ?? [];

    if (!isStaff(roles)) {
      return;
    }

    const day = localParts(startsAt, await clubTimezone(this.prisma, tenantId)).date;
    const problem = staffJoinProblem({
      roles,
      shiftOnDay: roles.includes('ADMIN') && (await this.staff.hasShiftOn(tenantId, userId, day)),
      ownSession: coachId === userId,
    });

    if (problem) {
      throw new ForbiddenException(problem);
    }
  }

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
