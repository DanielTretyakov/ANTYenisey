import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  AuditAction,
  BookingStatus,
  Prisma,
  VisitSourceType,
} from '@yenisey/database';
import type {
  AttendanceHistoryItem,
  AttendanceKind,
  AttendanceResult,
  DeskMarkInfo,
  DeskVisit,
  MarkAttendanceRequest,
  RecordVisitRequest,
} from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';
import { MembershipService } from '../club/membership.service';
import { decideMark, type AttendancePolicy } from './attendance-rules';

/**
 * Отметка присутствия: пришёл, не пришёл, визит с порога.
 *
 * За каждой отметкой стоят деньги — неявка списывает процент клуба, — поэтому
 * одна отметка это одна транзакция, в которой меняются запись, визит клиента и
 * журнал аудита. Разойтись им нельзя: запись «неявка» без строки журнала — это
 * списание, которое нечем объяснить клиенту, пришедшему с «я был».
 *
 * Сами правила — в `attendance-rules.ts`, чистой функцией под тестами. Здесь
 * только то, что без базы не сделать: блокировка, запись и журнал.
 */

/** Кто действует и откуда — для подписи в журнале аудита. */
export interface Actor {
  userId: string;
  ipAddress: string | null;
}

/**
 * Три вида записей и чем они различаются для отметки.
 *
 * Правила, транзакция и строка аудита у всех трёх одинаковы; различается
 * таблица, поле ссылки у визита и откуда брать время и тренера. Таблица здесь
 * — белый список для блокирующего запроса: имя подставляется в SQL, и прийти
 * оно может только отсюда.
 */
const KINDS = {
  TABLE: { table: 'TableBooking', link: 'tableBookingId', source: VisitSourceType.TABLE },
  TRAINING: { table: 'TrainingBooking', link: 'trainingBookingId', source: VisitSourceType.TRAINING },
  TOURNAMENT: {
    table: 'TournamentRegistration',
    link: 'tournamentRegistrationId',
    source: VisitSourceType.TOURNAMENT,
  },
} as const satisfies Record<AttendanceKind, unknown>;

/** Что пишется в журнал аудита как тип сущности. */
export const ENTITY_TYPE: Record<AttendanceKind, string> = {
  TABLE: KINDS.TABLE.table,
  TRAINING: KINDS.TRAINING.table,
  TOURNAMENT: KINDS.TOURNAMENT.table,
};

/** Действия журнала, из которых складывается история отметок записи. */
export const ATTENDANCE_ACTIONS: AuditAction[] = [
  AuditAction.ATTENDANCE_MARKED,
  AuditAction.NO_SHOW_MARKED,
  AuditAction.AUTO_NO_SHOW_APPLIED,
];

/** Запись в том объёме, в каком её касается отметка. Одна форма на три вида. */
export interface LoadedEntry {
  id: string;
  status: BookingStatus;
  chargeRatio: number | null;
  startsAt: Date;
  endsAt: Date;
  /** Пусто у спарринга: за столом тренер, клиента нет. */
  clientId: string | null;
  /** Тренер занятия или спарринга — ложится в визит клиента. */
  coachId: string | null;
}

/** Правила присутствия клуба вместе с процентом неявки. */
export type ClubAttendancePolicy = AttendancePolicy & { noShowChargePercent: number };

/** Сколько отметок принимает один пакет «отметить всех пришедшими». */
export const MAX_BATCH = 100;

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
  ) {}

  // --- Отметка ---------------------------------------------------------------

  /** Отметка одной записи. */
  async mark(
    tenantId: string,
    kind: AttendanceKind,
    entryId: string,
    request: MarkAttendanceRequest,
    actor: Actor,
  ): Promise<AttendanceResult> {
    const [result] = await this.markMany(tenantId, [{ kind, entryId, ...request }], actor);

    return result!;
  }

  /**
   * «Отметить всех пришедшими» — одной транзакцией.
   *
   * Всё или ничего: половина группы, отмеченная до первой ошибки, оставила бы
   * администратора гадать, кого система уже засчитала. Блокировки берутся в
   * одном порядке — по виду и идентификатору, — иначе два пакета, пересекшихся
   * составом, могли бы запереть друг друга.
   */
  async markMany(
    tenantId: string,
    marks: readonly (MarkAttendanceRequest & { kind: AttendanceKind; entryId: string })[],
    actor: Actor,
  ): Promise<AttendanceResult[]> {
    const keys = new Set(marks.map((mark) => `${mark.kind}:${mark.entryId}`));

    if (keys.size !== marks.length) {
      throw new BadRequestException('Одна и та же запись дважды в одном пакете');
    }

    const ordered = [...marks].sort((a, b) =>
      a.kind === b.kind ? a.entryId.localeCompare(b.entryId) : a.kind.localeCompare(b.kind),
    );

    try {
      const results = await this.prisma.$transaction(
        async (tx) => {
          const policy = await this.policyIn(tx, tenantId);
          const now = new Date();
          const done = new Map<string, AttendanceResult>();

          for (const mark of ordered) {
            done.set(
              `${mark.kind}:${mark.entryId}`,
              await this.applyInTx(tx, tenantId, mark.kind, mark.entryId, mark, actor, {
                now,
                noShowChargePercent: policy.noShowChargePercent,
              }),
            );
          }

          return done;
        },
        // Сотня записей по пять запросов на каждую в пять секунд по умолчанию
        // может не уложиться на медленной базе — и откатится вся группа.
        { timeout: 30_000 },
      );

      // Ответ — в порядке запроса, а не в порядке блокировок.
      return marks.map((mark) => results.get(`${mark.kind}:${mark.entryId}`)!);
    } catch (error) {
      // Неявка освобождает стол, и его могли занять. Вернуть «пришёл» значит
      // снова занять время, а два человека за одним столом не помещаются.
      if (String(error).includes('TableBooking_no_overlap')) {
        throw new ConflictException(
          'Стол в это время уже занят другой бронью — отметить присутствие нельзя',
        );
      }

      throw error;
    }
  }

  /**
   * Отметка внутри чужой транзакции.
   *
   * Отдельно от `mark`, потому что зовут её не только отсюда: бронь, которую
   * администратор заводит задним числом, должна стать «пришёл» в той же
   * транзакции, что и создаётся, — иначе через сутки её закрыла бы неявкой
   * джоба.
   *
   * Строка записи блокируется `FOR UPDATE` до конца транзакции: отметка,
   * отмена и джоба автонеявки не должны прочитать одно и то же состояние и
   * записать каждая своё.
   */
  async applyInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    kind: AttendanceKind,
    entryId: string,
    request: MarkAttendanceRequest,
    actor: Actor,
    context: { now: Date; noShowChargePercent: number },
  ): Promise<AttendanceResult> {
    const entry = await this.lockEntry(tx, tenantId, kind, entryId);
    const decision = decideMark(entry, request, context);

    if (!decision.ok) {
      throw new BadRequestException(decision.error);
    }

    if (!decision.changed) {
      return {
        kind,
        entryId,
        status: entry.status,
        chargePercent: entry.chargeRatio,
        changed: false,
      };
    }

    await this.updateEntry(tx, kind, entryId, {
      status: decision.status,
      chargeRatio: decision.chargeRatio,
    });

    await this.writeVisit(tx, tenantId, kind, entry, decision.status === 'ATTENDED', actor.userId);

    await tx.auditLog.create({
      data: {
        tenantId,
        action:
          decision.status === 'ATTENDED' ? AuditAction.ATTENDANCE_MARKED : AuditAction.NO_SHOW_MARKED,
        actorType: ActorType.USER,
        actorUserId: actor.userId,
        entityType: ENTITY_TYPE[kind],
        entityId: entryId,
        before: { status: entry.status, chargeRatio: entry.chargeRatio },
        after: { status: decision.status, chargeRatio: decision.chargeRatio },
        reason: decision.reason,
        ipAddress: actor.ipAddress,
      },
    });

    return {
      kind,
      entryId,
      status: decision.status,
      chargePercent: decision.chargeRatio,
      changed: true,
    };
  }

  // --- История ---------------------------------------------------------------

  /**
   * Кто, когда и с какой причиной отмечал запись — для спора с клиентом.
   *
   * Из журнала аудита, по порядку: запись хранит только нынешний статус, а
   * клиент спорит о том, как он таким стал.
   */
  async history(
    tenantId: string,
    kind: AttendanceKind,
    entryId: string,
  ): Promise<AttendanceHistoryItem[]> {
    if (!(await this.entryExists(this.prisma, tenantId, kind, entryId))) {
      throw new NotFoundException('Запись не найдена');
    }

    const rows = await this.prisma.auditLog.findMany({
      where: {
        tenantId,
        entityType: ENTITY_TYPE[kind],
        entityId: entryId,
        action: { in: ATTENDANCE_ACTIONS },
      },
      select: {
        createdAt: true,
        actorType: true,
        reason: true,
        before: true,
        after: true,
        actor: { select: { user: { select: { fullName: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => ({
      at: row.createdAt.toISOString(),
      by: row.actor?.user.fullName ?? null,
      auto: row.actorType === ActorType.SYSTEM_JOB,
      before: snapshotOf(row.before),
      after: snapshotOf(row.after),
      reason: row.reason,
    }));
  }

  /**
   * Кто поставил нынешнюю отметку — для каждой из переданных записей.
   *
   * Одним запросом на весь экран смены: последняя строка журнала по каждой
   * записи. У записей, отмеченных до появления журнала, строк нет, и отметка
   * без подписи — честнее выдуманной.
   */
  async marksOf(tenantId: string, entryIds: readonly string[]): Promise<Map<string, DeskMarkInfo>> {
    if (entryIds.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.auditLog.findMany({
      where: {
        tenantId,
        entityType: { in: Object.values(ENTITY_TYPE) },
        entityId: { in: [...new Set(entryIds)] },
        action: { in: ATTENDANCE_ACTIONS },
      },
      select: {
        entityId: true,
        createdAt: true,
        actorType: true,
        reason: true,
        actor: { select: { user: { select: { fullName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const marks = new Map<string, DeskMarkInfo>();

    for (const row of rows) {
      // Строки идут от свежих к старым: первая встреченная и есть нынешняя.
      if (marks.has(row.entityId)) continue;

      marks.set(row.entityId, {
        by: row.actor?.user.fullName ?? null,
        at: row.createdAt.toISOString(),
        reason: row.reason,
        auto: row.actorType === ActorType.SYSTEM_JOB,
      });
    }

    return marks;
  }

  // --- Визит с порога --------------------------------------------------------

  /**
   * Визит с порога или внесённый задним числом.
   *
   * Один инструмент на оба случая, как в ТЗ: человек пришёл без брони, или
   * играл, а записать забыли. Денег визит не двигает — это история клиента, а
   * не услуга с ценой.
   */
  async recordVisit(tenantId: string, dto: RecordVisitRequest, actor: Actor): Promise<DeskVisit> {
    const visitedAt = new Date(dto.visitedAt);

    if (Number.isNaN(visitedAt.getTime())) {
      throw new BadRequestException('Время визита указывается моментом в ISO-8601');
    }

    // Минута запаса — на расхождение часов администратора и сервера: «только
    // что пришёл» не должно отказывать из-за того, что у стойки часы спешат.
    if (visitedAt.getTime() > Date.now() + 60_000) {
      throw new BadRequestException('Визит не может быть в будущем');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: dto.clientId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('Человек не найден');
    }

    if (dto.coachId) {
      const coach = await this.prisma.coachProfile.findFirst({
        where: { userId: dto.coachId, tenantId },
        select: { userId: true },
      });

      // 400, а не 404: не найден не адрес, а значение в форме.
      if (!coach) {
        throw new BadRequestException('Тренер не найден в этом клубе');
      }
    }

    // Человек может не состоять в клубе: пришёл впервые, с порога. Привязка
    // заводится тем же кодом, что при записи, — второго пути быть не должно.
    await this.membership.ensureClient(tenantId, dto.clientId);

    try {
      const visit = await this.prisma.visitLog.create({
        data: {
          tenantId,
          clientId: dto.clientId,
          coachId: dto.coachId ?? null,
          sourceType: VisitSourceType.WALK_IN,
          attended: true,
          visitedAt,
          note: dto.note?.trim() || null,
          recordedByUserId: actor.userId,
        },
        select: VISIT_SELECT,
      });

      return visitOf(visit);
    } catch (error) {
      // Тот же человек в тот же момент — двойное нажатие, а не второй визит:
      // `VisitLog_walk_in_uniq`.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Этот визит уже внесён');
      }

      throw error;
    }
  }

  /** Визиты с порога клуба в промежутке — для экрана смены. */
  async visitsBetween(tenantId: string, from: Date, to: Date): Promise<DeskVisit[]> {
    const visits = await this.prisma.visitLog.findMany({
      where: {
        tenantId,
        sourceType: VisitSourceType.WALK_IN,
        visitedAt: { gte: from, lt: to },
      },
      select: VISIT_SELECT,
      orderBy: { visitedAt: 'asc' },
    });

    return visits.map(visitOf);
  }

  // --- Политика клуба --------------------------------------------------------

  async policy(tenantId: string): Promise<ClubAttendancePolicy> {
    return this.policyIn(this.prisma, tenantId);
  }

  private async policyIn(
    client: Prisma.TransactionClient | PrismaService,
    tenantId: string,
  ): Promise<ClubAttendancePolicy> {
    const tenant = await client.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        noShowChargePercent: true,
        attendanceReminderAfterMinutes: true,
        attendanceAutoNoShowAfterMinutes: true,
        attendanceTrackedSince: true,
      },
    });

    return {
      noShowChargePercent: tenant.noShowChargePercent,
      reminderAfterMinutes: tenant.attendanceReminderAfterMinutes,
      autoNoShowAfterMinutes: tenant.attendanceAutoNoShowAfterMinutes,
      trackedSince: tenant.attendanceTrackedSince,
    };
  }

  // --- Записи трёх видов -----------------------------------------------------

  /**
   * Запись под блокировкой строки — тот же рецепт, что у записи на занятие
   * (constraints.sql, раздел 4). Клуб — в условии: чужая запись по чужому
   * идентификатору должна выглядеть несуществующей, а не запертой.
   */
  async lockEntry(
    tx: Prisma.TransactionClient,
    tenantId: string,
    kind: AttendanceKind,
    entryId: string,
  ): Promise<LoadedEntry> {
    const locked = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT "id" FROM ${Prisma.raw(`"${KINDS[kind].table}"`)}
                 WHERE "id" = ${entryId} AND "tenantId" = ${tenantId}
                 FOR UPDATE`,
    );

    if (locked.length === 0) {
      throw new NotFoundException('Запись не найдена');
    }

    return this.readEntry(tx, kind, entryId);
  }

  private async readEntry(
    tx: Prisma.TransactionClient,
    kind: AttendanceKind,
    id: string,
  ): Promise<LoadedEntry> {
    switch (kind) {
      case 'TABLE': {
        const row = await tx.tableBooking.findUniqueOrThrow({
          where: { id },
          select: {
            status: true,
            chargeRatio: true,
            startsAt: true,
            endsAt: true,
            clientId: true,
            coachId: true,
          },
        });

        return { id, ...row };
      }

      case 'TRAINING': {
        const row = await tx.trainingBooking.findUniqueOrThrow({
          where: { id },
          select: {
            status: true,
            chargeRatio: true,
            clientId: true,
            session: { select: { startsAt: true, endsAt: true, coachId: true } },
          },
        });

        return {
          id,
          status: row.status,
          chargeRatio: row.chargeRatio,
          clientId: row.clientId,
          ...row.session,
        };
      }

      case 'TOURNAMENT': {
        const row = await tx.tournamentRegistration.findUniqueOrThrow({
          where: { id },
          select: {
            status: true,
            chargeRatio: true,
            clientId: true,
            tournament: { select: { startsAt: true, endsAt: true } },
          },
        });

        return {
          id,
          status: row.status,
          chargeRatio: row.chargeRatio,
          clientId: row.clientId,
          coachId: null,
          ...row.tournament,
        };
      }
    }
  }

  private async entryExists(
    client: PrismaService,
    tenantId: string,
    kind: AttendanceKind,
    id: string,
  ): Promise<boolean> {
    const where = { id, tenantId };
    const select = { id: true } as const;

    switch (kind) {
      case 'TABLE':
        return (await client.tableBooking.findFirst({ where, select })) !== null;
      case 'TRAINING':
        return (await client.trainingBooking.findFirst({ where, select })) !== null;
      case 'TOURNAMENT':
        return (await client.tournamentRegistration.findFirst({ where, select })) !== null;
    }
  }

  /**
   * Смена статуса записи.
   *
   * `where` с условием на статус — страховка для джобы, которая блокировку не
   * берёт: обновится только запись, всё ещё стоящая в ожидаемом статусе.
   * Возвращает, сколько строк обновилось.
   */
  async updateEntry(
    tx: Prisma.TransactionClient,
    kind: AttendanceKind,
    id: string,
    data: { status: BookingStatus; chargeRatio: number; autoNoShowAppliedAt?: Date },
    onlyIf?: BookingStatus,
  ): Promise<number> {
    const where = { id, ...(onlyIf ? { status: onlyIf } : {}) };

    switch (kind) {
      case 'TABLE':
        return (await tx.tableBooking.updateMany({ where, data })).count;
      case 'TRAINING':
        return (await tx.trainingBooking.updateMany({ where, data })).count;
      case 'TOURNAMENT':
        return (await tx.tournamentRegistration.updateMany({ where, data })).count;
    }
  }

  /**
   * Визит клиента по записи — один на запись.
   *
   * Первая отметка заводит его, исправление обновляет, а не заводит второй:
   * иначе в истории клиента одно занятие легло бы двумя визитами. Последний
   * рубеж — частичный уникальный индекс по ссылке (раздел 17 constraints.sql).
   *
   * У спарринга клиента нет — там за столом тренер, — и визита тоже нет: это
   * журнал визитов клиента, а статус, процент и строка аудита у брони есть и так.
   *
   * `recordedBy` пуст только у неявки от джобы — это проверяет база.
   */
  async writeVisit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    kind: AttendanceKind,
    entry: LoadedEntry,
    attended: boolean,
    recordedBy: string | null,
  ): Promise<void> {
    if (!entry.clientId) {
      return;
    }

    const link = { [KINDS[kind].link]: entry.id } as Record<
      (typeof KINDS)[AttendanceKind]['link'],
      string
    >;

    const existing = await tx.visitLog.findFirst({
      where: { tenantId, ...link },
      select: { id: true },
    });

    if (existing) {
      await tx.visitLog.update({
        where: { id: existing.id },
        data: { attended, recordedByUserId: recordedBy, recordedAt: new Date() },
      });

      return;
    }

    await tx.visitLog.create({
      data: {
        tenantId,
        clientId: entry.clientId,
        coachId: entry.coachId,
        sourceType: KINDS[kind].source,
        ...link,
        attended,
        // Визит — когда было занятие, а не когда его отметили: вчерашнее
        // отмечают сегодня, и история клиента не должна ехать на день.
        visitedAt: entry.startsAt,
        recordedByUserId: recordedBy,
      },
    });
  }
}

const VISIT_SELECT = {
  id: true,
  visitedAt: true,
  note: true,
  client: {
    select: { membership: { select: { user: { select: { id: true, fullName: true, phone: true } } } } },
  },
  coach: { select: { membership: { select: { user: { select: { fullName: true } } } } } },
  recordedBy: { select: { user: { select: { fullName: true } } } },
} as const;

function visitOf(row: {
  id: string;
  visitedAt: Date;
  note: string | null;
  client: { membership: { user: { id: string; fullName: string; phone: string } } };
  coach: { membership: { user: { fullName: string } } } | null;
  recordedBy: { user: { fullName: string } } | null;
}): DeskVisit {
  return {
    id: row.id,
    client: {
      userId: row.client.membership.user.id,
      fullName: row.client.membership.user.fullName,
      phone: row.client.membership.user.phone,
    },
    visitedAt: row.visitedAt.toISOString(),
    coachName: row.coach?.membership.user.fullName ?? null,
    note: row.note,
    recordedBy: row.recordedBy?.user.fullName ?? null,
  };
}

/** Состояние записи из JSON журнала. Строка чужого вида — не состояние. */
function snapshotOf(value: Prisma.JsonValue): AttendanceHistoryItem['before'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const { status, chargeRatio } = value as { status?: unknown; chargeRatio?: unknown };

  if (typeof status !== 'string') {
    return null;
  }

  return {
    status: status as BookingStatus,
    chargePercent: typeof chargeRatio === 'number' ? chargeRatio : null,
  };
}
