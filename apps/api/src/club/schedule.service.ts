import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus, Prisma } from '@yenisey/database';
import type {
  ClosureRule,
  ClosureRuleDraft,
  ClosureSlot,
  DayClosure,
  DayClosureDraft,
  DaySchedule,
  Weekday,
} from '@yenisey/types';
import { shortName } from '@yenisey/types';
import { ClientNotifier } from '../notifications/client-notifier.service';
import { PrismaService } from '../prisma/prisma.service';
import { hallScopeViolations, refKey, type ScopedRef } from './hall-scope';
import {
  findOverlap,
  formatMinutes,
  instantAt,
  ruleGroupKey,
  slotViolations,
  syncedTimes,
  templateViolations,
  weekdayOf,
  type Span,
} from './closures';

const WEEKDAY_NAMES = [
  '',
  'понедельник',
  'вторник',
  'среду',
  'четверг',
  'пятницу',
  'субботу',
  'воскресенье',
];

const SLOT_SELECT = {
  id: true,
  tableId: true,
  startMinute: true,
  endMinute: true,
  purpose: true,
  coachId: true,
  trainingTypeId: true,
} as const;

/** Турнир в шаблоне — типом, в расписании даты — конкретным проведением. */
const TEMPLATE_SELECT = { ...SLOT_SELECT, weekday: true, tournamentTypeId: true } as const;

/**
 * Окно даты — с проведением и его типом.
 *
 * Тип в окне даты не хранится, а выводится из турнира: без него сетке
 * пришлось бы тянуть все турниры клуба за всю историю ради подписи «Клуб 100»,
 * а при правке дня — гадать, есть ли в нём уже турнир этого типа.
 */
const DAY_SELECT = {
  ...SLOT_SELECT,
  tournamentId: true,
  trainingSessionId: true,
  tournament: { select: { tournamentTypeId: true } },
} as const;

/**
 * Расписание зала: постоянный шаблон недели и правки на конкретные даты.
 *
 * Шаблон описывает, как зал живёт обычно; расписание даты говорит «а вот
 * двенадцатого марта было иначе» и ЗАМЕНЯЕТ шаблон на эту дату целиком.
 * Замена, а не дополнение: иначе убрать одно занятие в одну субботу было бы
 * нечем — шаблон всё равно закрывал бы это время.
 */
@Injectable()
export class ScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: ClientNotifier,
  ) {}

  // --- Шаблон недели -------------------------------------------------------

  async findTemplate(tenantId: string, hallId: string): Promise<ClosureRule[]> {
    await this.assertHall(tenantId, hallId);

    const rules = await this.prisma.tableClosureRule.findMany({
      where: { tenantId, table: { hallId } },
      select: TEMPLATE_SELECT,
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
    });

    // Конкретного проведения в шаблоне не бывает — поле отдаём пустым ради
    // общего типа окна.
    return rules.map((rule) => ({
      ...rule,
      weekday: rule.weekday as Weekday,
      tournamentId: null,
      trainingSessionId: null,
    }));
  }

  /**
   * Замена всего шаблона зала разом.
   *
   * Не поштучное добавление и удаление: администратор правит расписание в
   * сетке, где одно движение мыши закрывает десяток окон. Считать разницу на
   * клиенте и надеяться, что она сошлась, — лишний источник расхождений.
   *
   * Удаление и вставка идут одной транзакцией: расписание, обнулённое на
   * полпути, означало бы, что зал на мгновение открыл клиентам всё подряд.
   */
  async replaceTemplate(
    tenantId: string,
    hallId: string,
    rules: ClosureRuleDraft[],
  ): Promise<ClosureRule[]> {
    await this.assertHall(tenantId, hallId);

    // Незаполненные поля приходят как undefined; в базу должен уехать явный
    // null, иначе Prisma просто не тронет колонку при обновлении.
    rules = rules
      .map(normalisePeople)
      .map((rule) => ({ ...rule, tournamentId: null, trainingSessionId: null }));

    await this.assertTablesInHall(tenantId, hallId, rules);
    await this.assertCatalogExists(tenantId, rules);
    await this.assertHallScope(tenantId, hallId, rules, await this.templateSlots(tenantId, hallId));
    this.assertSlotsValid(rules, templateViolations);
    this.assertNoOverlap(rules, ruleGroupKey, (rule) => ` в ${WEEKDAY_NAMES[rule.weekday]}`);

    const tableIds = await this.hallTableIds(tenantId, hallId);

    await this.prisma.$transaction([
      // Гасится расписание ТОЛЬКО этого зала: у соседнего своё, и трогать его
      // правка одного зала не должна.
      this.prisma.tableClosureRule.deleteMany({ where: { tenantId, tableId: { in: tableIds } } }),
      this.prisma.tableClosureRule.createMany({
        // Ни турнира, ни занятия в шаблоне не хранится — колонок таких нет.
        // Поля есть в общем типе окна, поэтому их надо снять явно.
        data: rules.map(({ tournamentId: _tournament, trainingSessionId: _session, ...rule }) => ({
          ...rule,
          tenantId,
        })),
      }),
    ]);

    return this.findTemplate(tenantId, hallId);
  }

  // --- Расписание конкретной даты -----------------------------------------

  /**
   * Что запланировано в зале на дату.
   *
   * `customised: false` означает, что день не правили и действует шаблон.
   * Пустой список у правленого дня — законное состояние: «в эту субботу
   * тренировок нет, все столы свободны».
   */
  async findDay(tenantId: string, hallId: string, date: string): Promise<DaySchedule> {
    await this.assertHall(tenantId, hallId);

    const schedule = await this.prisma.hallDaySchedule.findFirst({
      where: { tenantId, hallId, date: parseDate(date) },
      select: {
        closures: { select: DAY_SELECT, orderBy: { startMinute: 'asc' } },
      },
    });

    return {
      date,
      customised: schedule !== null,
      // Тип турнира у окна даты не хранится — он берётся у самого проведения.
      closures: (schedule?.closures ?? []).map(({ tournament, ...closure }) => ({
        ...closure,
        tournamentTypeId: tournament?.tournamentTypeId ?? null,
      })),
    };
  }

  /** Даты, на которых расписание отличается от шаблона, — чтобы подсветить их в календаре. */
  async findCustomisedDates(tenantId: string, hallId: string): Promise<string[]> {
    const schedules = await this.prisma.hallDaySchedule.findMany({
      where: { tenantId, hallId },
      select: { date: true },
      orderBy: { date: 'asc' },
    });

    return schedules.map((schedule) => formatDate(schedule.date));
  }

  async replaceDay(
    tenantId: string,
    hallId: string,
    date: string,
    closures: DayClosureDraft[],
  ): Promise<DaySchedule> {
    await this.assertHall(tenantId, hallId);

    closures = closures.map(normalisePeople);

    await this.assertTablesInHall(tenantId, hallId, closures);
    await this.assertCatalogExists(tenantId, closures);
    // «Было в зале» для даты — и её прежние окна, и шаблон: отвязанный день
    // начинается с копии шаблона, и тренер из шаблона не должен запирать правку.
    await this.assertHallScope(tenantId, hallId, closures, [
      ...(await this.templateSlots(tenantId, hallId)),
      ...(await this.daySlots(tenantId, hallId, date)),
    ]);
    this.assertSlotsValid(closures);
    this.assertNoOverlap(closures, (slot) => slot.tableId, () => '');

    const day = parseDate(date);

    await this.prisma.$transaction(async (tx) => {
      // Заголовок дня заводится даже под пустой список: именно он отличает
      // «в эту субботу ничего нет» от «субботу не правили».
      const schedule = await tx.hallDaySchedule.upsert({
        where: { hallId_date: { hallId, date: day } },
        update: {},
        create: { tenantId, hallId, date: day },
        select: { id: true },
      });

      // Что стояло в дне до правки — запоминается ДО удаления окон: после него
      // связь с мероприятиями теряется, и отличить стёртое из этого дня от
      // стоящего где-то ещё будет уже нечем.
      const before = await this.eventsOf(tx, { scheduleId: schedule.id });

      await tx.dayClosure.deleteMany({ where: { scheduleId: schedule.id } });
      await tx.dayClosure.createMany({
        // tournamentTypeId у расписания даты не хранится: там уже есть само
        // проведение, заведённое из этого типа.
        data: closures.map(({ tournamentTypeId: _type, ...closure }) => ({
          ...closure,
          tenantId,
          scheduleId: schedule.id,
        })),
      });

      await this.dropOrphanedEvents(tx, tenantId, before);
      await this.syncEventTimes(tx, tenantId, {
        sessionIds: closures.map((closure) => closure.trainingSessionId),
        tournamentIds: closures.map((closure) => closure.tournamentId),
      });
    });

    return this.findDay(tenantId, hallId, date);
  }

  /**
   * Возврат даты к шаблону: заголовок дня убирается, окна уходят каскадом.
   *
   * Вместе с днём уходят мероприятия, ставшие ничьими, — см.
   * `dropOrphanedEvents`. Раньше они оставались: занятие, заведённое правкой
   * этого дня, после возврата к шаблону не занимало ни одного стола, но клиент
   * по-прежнему видел его в ленте и мог на него записаться.
   */
  async resetDay(tenantId: string, hallId: string, date: string): Promise<DaySchedule> {
    await this.assertHall(tenantId, hallId);

    const day = parseDate(date);

    await this.prisma.$transaction(async (tx) => {
      const before = await this.eventsOf(tx, { schedule: { tenantId, hallId, date: day } });

      await tx.hallDaySchedule.deleteMany({ where: { tenantId, hallId, date: day } });

      await this.dropOrphanedEvents(tx, tenantId, before);
    });

    return this.findDay(tenantId, hallId, date);
  }

  /**
   * Отвязка даты от шаблона: расписание дня становится копией шаблона и дальше
   * живёт само по себе.
   *
   * Отдельным действием, а не побочным следствием «Сохранить». Раньше день,
   * показанный по шаблону, отвязывался первым же сохранением — даже без единой
   * правки, — и одно случайное нажатие навсегда отрывало субботу от шаблона
   * вместе с занятиями, которых администратор не рисовал.
   *
   * Занятия при отвязке НЕ заводятся. Окно тренировки без занятия законно —
   * стол закрыт, записываться некому, — а заводить запись на каждое окно,
   * доставшееся из шаблона, значило бы открыть клиентам группы, которые никто
   * не собирал. Их администратор ставит кистью.
   *
   * Турниры — заводятся, и это не непоследовательность, а требование базы:
   * окно турнира в расписании даты обязано ссылаться на само проведение
   * (`DayClosure_attachments_match_purpose`), а типа турнира у окна даты нет
   * вовсе. Турнир в шаблоне — это «каждую субботу Клуб 100»; зафиксировать
   * субботу как есть и значит завести её Клуб 100.
   *
   * Всё одной транзакцией: турнир без дня, в котором он стоит, был бы тем же
   * мусором, от которого эта функция и избавляет.
   */
  async detachDay(tenantId: string, hallId: string, date: string): Promise<DaySchedule> {
    const hall = await this.prisma.hall.findFirst({
      where: { id: hallId, tenantId },
      select: { timezone: true },
    });

    if (!hall) {
      throw new NotFoundException('Зал не найден');
    }

    const day = parseDate(date);

    const rules = await this.prisma.tableClosureRule.findMany({
      where: { tenantId, table: { hallId }, weekday: weekdayOf(date) },
      select: TEMPLATE_SELECT,
    });

    try {
      await this.prisma.$transaction(async (tx) => {
        // Уже отвязанный день не трогаем: второе нажатие — не ошибка, а то же
        // намерение, и отвечать на него надо тем же состоянием.
        const existing = await tx.hallDaySchedule.findFirst({
          where: { tenantId, hallId, date: day },
          select: { id: true },
        });

        if (existing) {
          return;
        }

        // Один турнир на тип и дату: два турнира одного типа в один день клуб
        // не проводит. Границы — от самого раннего начала до самого позднего
        // конца окон этого типа.
        const tournaments = new Map<string, string>();
        const typeIds = new Set(
          rules.map((rule) => rule.tournamentTypeId).filter((id): id is string => id !== null),
        );

        for (const typeId of typeIds) {
          const own = rules.filter((rule) => rule.tournamentTypeId === typeId);

          const created = await tx.tournament.create({
            data: {
              tenantId,
              tournamentTypeId: typeId,
              // Пояс ЗАЛА: от момента начала считается порог отмены, от
              // окончания — срок отметки присутствия.
              startsAt: instantAt(date, Math.min(...own.map((rule) => rule.startMinute)), hall.timezone),
              endsAt: instantAt(date, Math.max(...own.map((rule) => rule.endMinute)), hall.timezone),
            },
            select: { id: true },
          });

          tournaments.set(typeId, created.id);
        }

        const schedule = await tx.hallDaySchedule.create({
          data: { tenantId, hallId, date: day },
          select: { id: true },
        });

        await tx.dayClosure.createMany({
          // Поля перечислены руками: у шаблонного окна есть weekday и тип
          // турнира, которых у окна даты нет и быть не может.
          data: rules.map((rule) => ({
            tenantId,
            scheduleId: schedule.id,
            tableId: rule.tableId,
            startMinute: rule.startMinute,
            endMinute: rule.endMinute,
            purpose: rule.purpose,
            coachId: rule.coachId,
            trainingTypeId: rule.trainingTypeId,
            trainingSessionId: null,
            tournamentId: rule.tournamentTypeId
              ? (tournaments.get(rule.tournamentTypeId) ?? null)
              : null,
          })),
        });
      });
    } catch (error) {
      // Два одновременных нажатия: второе упрётся в уникальность дня, и его
      // транзакция откатится целиком — вместе с турнирами. Ответ тот же, что у
      // первого.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw error;
      }
    }

    return this.findDay(tenantId, hallId, date);
  }

  // --- Мероприятия без расписания -----------------------------------------

  /** Занятия и турниры, на которые ссылаются окна, подходящие под условие. */
  private async eventsOf(
    tx: Prisma.TransactionClient,
    where: Prisma.DayClosureWhereInput,
  ): Promise<{ sessionIds: string[]; tournamentIds: string[] }> {
    const closures = await tx.dayClosure.findMany({
      where,
      select: { trainingSessionId: true, tournamentId: true },
    });

    const present = (id: string | null): id is string => id !== null;

    return {
      sessionIds: [...new Set(closures.map((closure) => closure.trainingSessionId).filter(present))],
      tournamentIds: [...new Set(closures.map((closure) => closure.tournamentId).filter(present))],
    };
  }

  /**
   * Снос мероприятий, оставшихся без расписания.
   *
   * Занятие, которое не занимает ни одного стола, клиент всё равно видит в
   * ленте и может на него записаться — это уже не мусор, а неверные данные.
   * Осиротеть оно может двумя путями: возвратом дня к шаблону и правкой дня, в
   * которой окно стёрли. Поэтому проверка живёт в одном месте.
   *
   * Условие намеренно узкое:
   * - только то, что стояло в изменённом дне, — заготовки из каталога, ни в
   *   один день не поставленные, в набор не попадают вовсе;
   * - только то, что после правки не стоит ни в одном дне, — занятие,
   *   поставленное в две даты, переживает правку одной;
   * - только без записей, даже отменённых: за записью стоит история денег, и
   *   внешний ключ такое удаление не пропустит всё равно.
   */
  private async dropOrphanedEvents(
    tx: Prisma.TransactionClient,
    tenantId: string,
    events: { sessionIds: string[]; tournamentIds: string[] },
  ): Promise<void> {
    if (events.sessionIds.length > 0) {
      await tx.trainingSession.deleteMany({
        where: {
          tenantId,
          id: { in: events.sessionIds },
          dayClosures: { none: {} },
          bookings: { none: {} },
        },
      });
    }

    if (events.tournamentIds.length > 0) {
      await tx.tournament.deleteMany({
        where: {
          tenantId,
          id: { in: events.tournamentIds },
          dayClosures: { none: {} },
          registrations: { none: {} },
        },
      });
    }
  }

  /**
   * Границы занятий и турниров — по их окнам в расписании.
   *
   * Администратор растянул группу или турнир в сетке на час — и экран смены,
   * и напоминания, и джоба автонеявки должны узнать об этом сразу, а не читать
   * границы, указанные при заведении. Считается по ВСЕМ окнам мероприятия, а
   * не только по окнам этого дня: турнир одного дня законно идёт в двух залах.
   *
   * Что именно двигается — решает `syncedTimes`: границы следуют за окнами,
   * кроме начала уже начавшегося. Сдвинулось начало — записавшимся сообщение
   * «время изменилось» той же транзакцией (решение владельца от 05.10.2026,
   * вариант «б»): порог бесплатной отмены считается теперь от нового начала,
   * и человек должен об этом знать.
   */
  private async syncEventTimes(
    tx: Prisma.TransactionClient,
    tenantId: string,
    ids: { sessionIds: (string | null | undefined)[]; tournamentIds: (string | null | undefined)[] },
  ): Promise<void> {
    const present = (list: (string | null | undefined)[]): string[] => [
      ...new Set(list.filter((id): id is string => typeof id === 'string')),
    ];
    const sessionIds = present(ids.sessionIds);
    const tournamentIds = present(ids.tournamentIds);

    if (sessionIds.length === 0 && tournamentIds.length === 0) {
      return;
    }

    const closures = await tx.dayClosure.findMany({
      where: {
        tenantId,
        OR: [{ trainingSessionId: { in: sessionIds } }, { tournamentId: { in: tournamentIds } }],
      },
      select: {
        trainingSessionId: true,
        tournamentId: true,
        startMinute: true,
        endMinute: true,
        schedule: { select: { date: true, hall: { select: { timezone: true } } } },
      },
    });

    const spans = new Map<string, Span>();
    const widen = (key: string, startsAt: number, endsAt: number): void => {
      const span = spans.get(key);

      spans.set(key, {
        startsAt: Math.min(span?.startsAt ?? startsAt, startsAt),
        endsAt: Math.max(span?.endsAt ?? endsAt, endsAt),
      });
    };

    for (const closure of closures) {
      const date = formatDate(closure.schedule.date);
      const timezone = closure.schedule.hall.timezone;
      const startsAt = instantAt(date, closure.startMinute, timezone).getTime();
      const endsAt = instantAt(date, closure.endMinute, timezone).getTime();

      if (closure.trainingSessionId) widen(`session:${closure.trainingSessionId}`, startsAt, endsAt);
      if (closure.tournamentId) widen(`tournament:${closure.tournamentId}`, startsAt, endsAt);
    }

    const [sessions, tournaments] = await Promise.all([
      sessionIds.length > 0
        ? tx.trainingSession.findMany({
            where: { tenantId, id: { in: sessionIds } },
            select: {
              id: true,
              startsAt: true,
              endsAt: true,
              bookings: { where: { status: BookingStatus.BOOKED }, select: { id: true } },
            },
          })
        : [],
      tournamentIds.length > 0
        ? tx.tournament.findMany({
            where: { tenantId, id: { in: tournamentIds } },
            select: {
              id: true,
              startsAt: true,
              endsAt: true,
              registrations: { where: { status: BookingStatus.BOOKED }, select: { id: true } },
            },
          })
        : [],
    ]);

    const now = Date.now();

    for (const session of sessions) {
      const next = this.nextTimes(session, spans.get(`session:${session.id}`), session.startsAt.getTime() <= now);

      if (next) {
        await tx.trainingSession.update({ where: { id: session.id }, data: next });
        await this.tellRescheduled(tx, tenantId, 'TRAINING', session.bookings, session.startsAt, next.startsAt);
      }
    }

    for (const tournament of tournaments) {
      const next = this.nextTimes(
        tournament,
        spans.get(`tournament:${tournament.id}`),
        tournament.startsAt.getTime() <= now,
      );

      if (next) {
        await tx.tournament.update({ where: { id: tournament.id }, data: next });
        await this.tellRescheduled(tx, tenantId, 'TOURNAMENT', tournament.registrations, tournament.startsAt, next.startsAt);
      }
    }
  }

  /** Записавшимся — «время изменилось», если сдвинулось начало. Конец порога отмены не меняет. */
  private async tellRescheduled(
    tx: Prisma.TransactionClient,
    tenantId: string,
    kind: 'TRAINING' | 'TOURNAMENT',
    entries: { id: string }[],
    before: Date,
    after: Date,
  ): Promise<void> {
    if (before.getTime() === after.getTime()) {
      return;
    }

    for (const entry of entries) {
      await this.notifier.entryRescheduled(tx, tenantId, kind, entry.id, before);
    }
  }

  /** Границы мероприятия после правки окон — или null, если менять нечего. */
  private nextTimes(
    event: { startsAt: Date; endsAt: Date },
    windows: Span | undefined,
    started: boolean,
  ): { startsAt: Date; endsAt: Date } | null {
    if (!windows) {
      return null;
    }

    const next = syncedTimes(
      { startsAt: event.startsAt.getTime(), endsAt: event.endsAt.getTime() },
      windows,
      started,
    );

    return next ? { startsAt: new Date(next.startsAt), endsAt: new Date(next.endsAt) } : null;
  }

  // --- Залы видов и тренеров ------------------------------------------------

  /**
   * В расписании зала — только виды и тренеры этого зала (решение владельца
   * от 25.09.2026, «строго»). Проверяется лишь то, чего в зале до правки не
   * было (`before`): сужение привязки не должно запирать правку уже
   * заведённых дней. Правило — `hallScopeViolations` в `hall-scope.ts`.
   */
  private async assertHallScope(
    tenantId: string,
    hallId: string,
    slots: readonly ClosureSlot[],
    before: readonly ClosureSlot[],
  ): Promise<void> {
    const [refs, previous] = await Promise.all([this.scopedRefs(tenantId, slots), this.scopedRefs(tenantId, before)]);
    const violations = hallScopeViolations(hallId, refs, new Set(previous.map(refKey)));

    if (violations.length > 0) {
      throw new BadRequestException(violations);
    }
  }

  /**
   * На кого и на что ссылаются окна: тренер, вид занятия, вид турнира — с
   * привязкой к залам. Занятие и турнир дня раскрываются в свой вид и тренера.
   */
  private async scopedRefs(tenantId: string, slots: readonly ClosureSlot[]): Promise<ScopedRef[]> {
    const ids = (pick: (slot: ClosureSlot) => string | null | undefined): string[] => [
      ...new Set(slots.map(pick).filter((id): id is string => typeof id === 'string')),
    ];

    const sessionIds = ids((slot) => slot.trainingSessionId);
    const tournamentIds = ids((slot) => slot.tournamentId);
    const [sessions, tournaments] = await Promise.all([
      sessionIds.length > 0
        ? this.prisma.trainingSession.findMany({
            where: { tenantId, id: { in: sessionIds } },
            select: { trainingTypeId: true, coachId: true },
          })
        : [],
      tournamentIds.length > 0
        ? this.prisma.tournament.findMany({
            where: { tenantId, id: { in: tournamentIds } },
            select: { tournamentTypeId: true },
          })
        : [],
    ]);

    const coachIds = [...new Set([...ids((slot) => slot.coachId), ...sessions.map((row) => row.coachId)])];
    const trainingTypeIds = [
      ...new Set([...ids((slot) => slot.trainingTypeId), ...sessions.map((row) => row.trainingTypeId)]),
    ];
    const tournamentTypeIds = [
      ...new Set([...ids((slot) => slot.tournamentTypeId), ...tournaments.map((row) => row.tournamentTypeId)]),
    ];

    const [coaches, trainingTypes, tournamentTypes] = await Promise.all([
      coachIds.length > 0
        ? this.prisma.coachProfile.findMany({
            where: { tenantId, userId: { in: coachIds } },
            select: {
              userId: true,
              membership: { select: { user: { select: { fullName: true } } } },
              halls: { select: { hallId: true } },
            },
          })
        : [],
      trainingTypeIds.length > 0
        ? this.prisma.trainingType.findMany({
            where: { tenantId, id: { in: trainingTypeIds } },
            select: { id: true, name: true, halls: { select: { hallId: true } } },
          })
        : [],
      tournamentTypeIds.length > 0
        ? this.prisma.tournamentType.findMany({
            where: { tenantId, id: { in: tournamentTypeIds } },
            select: { id: true, name: true, halls: { select: { hallId: true } } },
          })
        : [],
    ]);

    return [
      ...coaches.map((row) => ({
        kind: 'coach' as const,
        id: row.userId,
        name: shortName(row.membership.user.fullName),
        links: row.halls.map((link) => link.hallId),
      })),
      ...trainingTypes.map((row) => ({
        kind: 'training' as const,
        id: row.id,
        name: row.name,
        links: row.halls.map((link) => link.hallId),
      })),
      ...tournamentTypes.map((row) => ({
        kind: 'tournament' as const,
        id: row.id,
        name: row.name,
        links: row.halls.map((link) => link.hallId),
      })),
    ];
  }

  /** Окна шаблона недели этого зала — как есть в базе. */
  private async templateSlots(tenantId: string, hallId: string): Promise<ClosureSlot[]> {
    const rules = await this.prisma.tableClosureRule.findMany({
      where: { tenantId, table: { hallId } },
      select: TEMPLATE_SELECT,
    });

    return rules.map((rule) => ({ ...rule, tournamentId: null, trainingSessionId: null }));
  }

  /** Окна даты этого зала — как есть в базе; день не правили — пусто. */
  private async daySlots(tenantId: string, hallId: string, date: string): Promise<ClosureSlot[]> {
    const closures = await this.prisma.dayClosure.findMany({
      where: { tenantId, schedule: { hallId, date: parseDate(date) } },
      select: { ...SLOT_SELECT, tournamentId: true, trainingSessionId: true },
    });

    return closures.map((closure) => ({ ...closure, tournamentTypeId: null }));
  }

  // --- Общие проверки ------------------------------------------------------

  private async assertHall(tenantId: string, hallId: string): Promise<void> {
    const hall = await this.prisma.hall.findFirst({
      where: { id: hallId, tenantId },
      select: { id: true },
    });

    if (!hall) {
      throw new NotFoundException('Зал не найден');
    }
  }

  private async hallTableIds(tenantId: string, hallId: string): Promise<string[]> {
    const tables = await this.prisma.table.findMany({
      where: { tenantId, hallId },
      select: { id: true },
    });

    return tables.map((table) => table.id);
  }

  /**
   * Все столы расписания принадлежат этому залу.
   *
   * Составной внешний ключ не дал бы записать чужой стол и сам, но зал он не
   * проверяет вовсе: стол соседнего зала того же клуба прошёл бы насквозь и
   * попал в чужое расписание.
   */
  private async assertTablesInHall(
    tenantId: string,
    hallId: string,
    slots: readonly ClosureSlot[],
  ): Promise<void> {
    const unique = [...new Set(slots.map((slot) => slot.tableId))];

    if (unique.length === 0) {
      return;
    }

    const found = await this.prisma.table.count({
      where: { tenantId, hallId, id: { in: unique } },
    });

    if (found !== unique.length) {
      throw new BadRequestException('В расписании указан стол, которого нет в этом зале');
    }
  }

  /**
   * Типы тренировок и турниры из расписания существуют в этом клубе.
   *
   * Составной внешний ключ не дал бы записать чужой справочник и сам, но отдал
   * бы это ошибкой базы. Проверка здесь — ради внятного ответа.
   */
  private async assertCatalogExists(
    tenantId: string,
    slots: readonly ClosureSlot[],
  ): Promise<void> {
    const trainingTypeIds = [
      ...new Set(slots.map((slot) => slot.trainingTypeId).filter((id): id is string => id !== null)),
    ];
    const tournamentIds = [
      ...new Set(slots.map((slot) => slot.tournamentId).filter((id): id is string => id !== null)),
    ];

    if (trainingTypeIds.length > 0) {
      const found = await this.prisma.trainingType.count({
        where: { tenantId, id: { in: trainingTypeIds } },
      });

      if (found !== trainingTypeIds.length) {
        throw new BadRequestException('В расписании указан неизвестный тип тренировки');
      }
    }

    if (tournamentIds.length > 0) {
      const found = await this.prisma.tournament.count({
        where: { tenantId, id: { in: tournamentIds } },
      });

      if (found !== tournamentIds.length) {
        throw new BadRequestException('В расписании указан неизвестный турнир');
      }
    }

    const tournamentTypeIds = [
      ...new Set(
        slots.map((slot) => slot.tournamentTypeId).filter((id): id is string => id !== null),
      ),
    ];

    if (tournamentTypeIds.length > 0) {
      const found = await this.prisma.tournamentType.count({
        where: { tenantId, id: { in: tournamentTypeIds } },
      });

      if (found !== tournamentTypeIds.length) {
        throw new BadRequestException('В расписании указан неизвестный тип турнира');
      }
    }

    const sessionIds = [
      ...new Set(
        slots.map((slot) => slot.trainingSessionId).filter((id): id is string => id !== null),
      ),
    ];

    if (sessionIds.length > 0) {
      const found = await this.prisma.trainingSession.count({
        where: { tenantId, id: { in: sessionIds } },
      });

      if (found !== sessionIds.length) {
        throw new BadRequestException('В расписании указано неизвестное занятие');
      }
    }
  }

  private assertSlotsValid(
    slots: readonly ClosureSlot[],
    check: (slot: ClosureSlot) => string[] = slotViolations,
  ): void {
    const violations = slots.flatMap((slot) => check(slot));

    if (violations.length > 0) {
      // Дубли убираем: одна и та же ошибка в десяти окнах подряд — это одно
      // замечание, а не десять строк в списке.
      throw new BadRequestException([...new Set(violations)]);
    }
  }

  private assertNoOverlap<T extends ClosureSlot>(
    slots: readonly T[],
    groupKey: (slot: T) => string,
    where: (slot: T) => string,
  ): void {
    const overlap = findOverlap(slots, groupKey);

    if (!overlap) {
      return;
    }

    // Та же проверка стоит exclusion-констрейнтом в базе, и последнее слово за
    // ней. Здесь она повторена ради сообщения: администратор должен увидеть,
    // какие именно окна конфликтуют.
    const [first, second] = overlap;

    throw new BadRequestException(
      `Два окна одного стола накладываются друг на друга${where(first)}: ` +
        `${formatMinutes(first.startMinute)}–${formatMinutes(first.endMinute)} и ` +
        `${formatMinutes(second.startMinute)}–${formatMinutes(second.endMinute)}`,
    );
  }
}

/** Приведение необязательных полей к явному null. */
function normalisePeople<T extends ClosureSlot>(slot: T): T {
  return {
    ...slot,
    coachId: slot.coachId ?? null,
    trainingTypeId: slot.trainingTypeId ?? null,
    trainingSessionId: slot.trainingSessionId ?? null,
    tournamentId: slot.tournamentId ?? null,
    tournamentTypeId: slot.tournamentTypeId ?? null,
  };
}

/**
 * «2026-03-12» → полночь UTC этой даты.
 *
 * Колонка типа DATE часов не хранит вовсе, но Prisma требует Date. Полночь
 * именно UTC, а не местная: иначе на клубе восточнее Гринвича дата в базе
 * сдвинулась бы на сутки назад.
 */
function parseDate(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new BadRequestException('Дата указывается в виде 2026-03-12');
  }

  const parsed = new Date(`${date}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`Даты «${date}» не существует`);
  }

  return parsed;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
