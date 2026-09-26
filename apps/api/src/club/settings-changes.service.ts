import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type SettingsChangeKind } from '@yenisey/database';
import {
  IMMEDIATE_CLUB_FIELDS,
  shortName,
  type ClubSettings,
  type ClubTable,
  type CreateHallRequest,
  type Hall,
  type SettingsChange,
  type SettingsChangeStatus,
  type UpdateClubSettingsRequest,
  type UpdateHallRequest,
} from '@yenisey/types';
import type { ClubContext } from '../auth/club-context';
import { clubTimezone } from '../notifications/clock';
import type { SettingsChangedPayload } from '../notifications/render';
import { StaffNotifier } from '../notifications/staff-notifier.service';
import { PrismaService } from '../prisma/prisma.service';
import { instantAt, localParts } from './closures';
import { ClubService } from './club.service';
import {
  CLUB_DEFERRED_FIELDS,
  changedFields,
  defaultTableLabels,
  effectiveLabel,
  hallChanges,
  hallCreatedLines,
  nextDate,
} from './settings-diff';

type Tx = Prisma.TransactionClient;

/** Сколько дней показывать уже применённые и отменённые правки. */
const HISTORY_DAYS = 7;

/** Правка в очереди: то, что нужно для проекции «как будет после полуночи». */
interface Queued {
  id: string;
  kind: SettingsChangeKind;
  targetId: string | null;
  payload: Record<string, unknown>;
}

/** Правка не применилась по делу — причина для людей, а не для журнала. */
class ApplyProblem extends Error {}

/**
 * Отложенные правки настроек клуба (решение владельца от 26.09.2026).
 *
 * Всё со страницы «Настройки» — клуб, залы, столы — вступает в силу в
 * ближайшие 00:00 по поясу зала, а не посреди рабочего дня: цена, поменянная
 * в обед, разошлась бы с той, что администратор назвал утром, а стол,
 * удалённый во время смены, пропал бы из сетки у всех разом. Сразу меняется
 * только оформление страницы клуба (`IMMEDIATE_CLUB_FIELDS`, баннер, состав).
 *
 * Правка проверяется при сохранении — теми же правилами, что раньше при
 * записи, и против проекции «как будет после уже запланированного»: иначе
 * две правки подряд заняли бы одно название. Пишет её в полночь
 * `SettingsChangesJob`, по порядку сохранения. Что изменилось за это время
 * (у стола появилась бронь), ловит повторная проверка и база: правка тогда
 * помечается неудачной, и персонал получает сообщение с причиной.
 *
 * О каждой сохранённой и отменённой правке сообщается всем сотрудникам
 * клуба, тренерам тоже: кто, что и когда вступит в силу.
 */
@Injectable()
export class SettingsChangesService {
  private readonly logger = new Logger(SettingsChangesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly club: ClubService,
    private readonly notifier: StaffNotifier,
  ) {}

  // --- Сохранение ----------------------------------------------------------

  /**
   * Правка настроек клуба. Оформление страницы пишется сразу, остальное —
   * в очередь. Ответ — настройки такими, какими они станут.
   */
  async updateSettings(club: ClubContext, patch: UpdateClubSettingsRequest): Promise<ClubSettings> {
    const { current, next } = await this.club.prepareSettings(club.tenantId, patch);
    const now: Record<string, unknown> = {};

    for (const field of IMMEDIATE_CLUB_FIELDS) {
      if (next[field] !== undefined && JSON.stringify(next[field]) !== JSON.stringify(current[field] ?? null)) {
        now[field] = next[field];
      }
    }

    if (Object.keys(now).length > 0) {
      await this.club.writeSettingsNow(club.tenantId, now);
    }

    const cities = await this.cityNames([current.cityId, next.cityId as string | null | undefined]);
    const { data, lines } = changedFields(CLUB_DEFERRED_FIELDS, current as unknown as Record<string, unknown>, next, cities);

    if (lines.length > 0) {
      await this.enqueue(club, {
        kind: 'CLUB',
        targetId: null,
        payload: { data },
        summary: lines,
        timezone: await clubTimezone(this.prisma, club.tenantId),
      });
    }

    return { ...current, ...next } as ClubSettings;
  }

  async createHall(club: ClubContext, dto: CreateHallRequest): Promise<Hall> {
    const data = await this.club.prepareHallCreate(dto);
    const queue = await this.queue(club.tenantId);
    const names = await this.hallNames(club.tenantId, queue);

    if ([...names.values()].includes(data.name)) {
      throw new ConflictException(`Зал «${data.name}» в клубе уже есть`);
    }

    const id = randomUUID();
    const tableCount = dto.tableCount ?? 0;

    await this.enqueue(club, {
      kind: 'HALL_CREATE',
      targetId: id,
      payload: { data, tableCount },
      summary: hallCreatedLines({ ...data, tableCount }),
      timezone: data.timezone,
    });

    return { ...data, id, managerId: null };
  }

  async updateHall(club: ClubContext, hallId: string, patch: UpdateHallRequest): Promise<Hall> {
    const { current, next } = await this.club.prepareHallUpdate(club.tenantId, hallId, patch);
    const queue = await this.queue(club.tenantId);

    if (queue.some((item) => item.kind === 'HALL_DELETE' && item.targetId === hallId)) {
      throw new ConflictException('Зал удаляется в полночь — сначала отмените удаление');
    }

    if (typeof next.name === 'string' && next.name !== current.name) {
      const names = await this.hallNames(club.tenantId, queue);
      names.delete(hallId);

      if ([...names.values()].includes(next.name)) {
        throw new ConflictException(`Зал «${next.name}» в клубе уже есть`);
      }
    }

    const cities = await this.cityNames([current.cityId, next.cityId as string | null | undefined]);
    const { data, lines } = hallChanges(current as unknown as Record<string, unknown>, next, cities);

    if (Object.keys(data).length === 0) {
      return current;
    }

    await this.enqueue(club, {
      kind: 'HALL_UPDATE',
      targetId: hallId,
      payload: { data },
      summary: (lines.length > 0 ? lines : ['Адрес: уточнён код дома']).map((line) => inHall(current.name, line)),
      timezone: current.timezone,
    });

    return { ...current, ...data } as Hall;
  }

  /**
   * Удаление зала. Зал со столами удалить нельзя: за столами стоят брони и
   * расписание, и каскад унёс бы их молча. Столы считаются с очередью: стол,
   * удаление которого уже запланировано, удалению зала не мешает — в полночь
   * он уйдёт первым.
   */
  async deleteHall(club: ClubContext, hallId: string): Promise<void> {
    const [hall, tables, halls, queue] = await Promise.all([
      this.prisma.hall.findFirst({ where: { id: hallId, tenantId: club.tenantId }, select: { name: true, timezone: true } }),
      this.prisma.table.findMany({ where: { hallId, tenantId: club.tenantId }, select: { id: true } }),
      this.prisma.hall.count({ where: { tenantId: club.tenantId } }),
      this.queue(club.tenantId),
    ]);

    if (!hall) {
      throw new NotFoundException('Зал не найден');
    }

    if (queue.some((item) => item.kind === 'HALL_DELETE' && item.targetId === hallId)) {
      throw new ConflictException('Удаление этого зала уже запланировано');
    }

    const left = this.tableLabels(
      new Map(tables.map((table) => [table.id, ''])),
      hallId,
      queue,
    ).size;

    if (left > 0) {
      throw new ConflictException(`В зале ${left} ${plural(left, 'стол', 'стола', 'столов')} — сначала уберите их`);
    }

    // Клуб без единого зала не может ни назначить цену, ни завести стол:
    // настройки аренды живут только у зала.
    const created = queue.filter((item) => item.kind === 'HALL_CREATE').length;
    const deleted = queue.filter((item) => item.kind === 'HALL_DELETE').length;

    if (halls + created - deleted <= 1) {
      throw new ConflictException('Это единственный зал клуба, удалить его нельзя');
    }

    await this.enqueue(club, {
      kind: 'HALL_DELETE',
      targetId: hallId,
      payload: {},
      summary: [`Удаление зала «${hall.name}»`],
      timezone: hall.timezone,
    });
  }

  async createTable(club: ClubContext, hallId: string, label: string): Promise<ClubTable> {
    // Зал проверяется отдельно: составной внешний ключ не дал бы записать
    // чужой зал и сам, но отдал бы это ошибкой базы — и только в полночь.
    const hall = await this.club.findHall(club.tenantId, hallId);
    const queue = await this.queue(club.tenantId);

    if (queue.some((item) => item.kind === 'HALL_DELETE' && item.targetId === hallId)) {
      throw new ConflictException('Зал удаляется в полночь — стол в него не добавить');
    }

    const labels = await this.hallTableLabels(club.tenantId, hallId, queue);

    if ([...labels.values()].includes(label)) {
      throw new ConflictException(`Стол «${label}» в этом зале уже есть`);
    }

    const id = randomUUID();

    await this.enqueue(club, {
      kind: 'TABLE_CREATE',
      targetId: id,
      payload: { hallId, label },
      summary: [inHall(hall.name, `Новый стол «${label}»`)],
      timezone: hall.timezone,
    });

    return { id, hallId, label, hasBookings: false, closureCount: 0 };
  }

  async renameTable(club: ClubContext, tableId: string, label: string): Promise<ClubTable> {
    const table = await this.table(club.tenantId, tableId);
    const current: ClubTable = {
      id: table.id,
      hallId: table.hallId,
      label: table.label,
      hasBookings: table._count.bookings > 0,
      closureCount: table._count.closureRules + table._count.dayClosures,
    };

    if (label === table.label) {
      return current;
    }

    const queue = await this.queue(club.tenantId);
    const labels = await this.hallTableLabels(club.tenantId, table.hallId, queue);
    labels.delete(tableId);

    if ([...labels.values()].includes(label)) {
      throw new ConflictException(`Стол «${label}» в этом зале уже есть`);
    }

    await this.enqueue(club, {
      kind: 'TABLE_RENAME',
      targetId: tableId,
      payload: { hallId: table.hallId, label },
      summary: [inHall(table.hall.name, `Стол «${table.label}» → «${label}»`)],
      timezone: table.hall.timezone,
    });

    return { ...current, label };
  }

  /**
   * Удаление стола. Стол с бронями удалить нельзя: за бронями висят платежи,
   * и внешний ключ стоит на `Restrict`. Бронь может появиться и до полуночи —
   * тогда правка не применится, и персонал узнает причину.
   */
  async deleteTable(club: ClubContext, tableId: string): Promise<void> {
    const table = await this.table(club.tenantId, tableId);

    if (table._count.bookings > 0) {
      throw new ConflictException('У стола есть брони, поэтому удалить его нельзя — за бронями стоят платежи');
    }

    const queue = await this.queue(club.tenantId);

    if (queue.some((item) => item.kind === 'TABLE_DELETE' && item.targetId === tableId)) {
      throw new ConflictException('Удаление этого стола уже запланировано');
    }

    const closures = table._count.closureRules + table._count.dayClosures;

    await this.enqueue(club, {
      kind: 'TABLE_DELETE',
      targetId: tableId,
      payload: { hallId: table.hallId },
      summary: [
        inHall(
          table.hall.name,
          closures > 0
            ? `Удаление стола «${table.label}» вместе с ${closures} ${plural(closures, 'окном', 'окнами', 'окнами')} расписания`
            : `Удаление стола «${table.label}»`,
        ),
      ],
      timezone: table.hall.timezone,
    });
  }

  // --- Список и отмена -----------------------------------------------------

  /** Запланированные правки и недавняя история — для страницы настроек. */
  async list(tenantId: string): Promise<SettingsChange[]> {
    const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.settingsChange.findMany({
      where: {
        tenantId,
        OR: [
          { appliedAt: null, cancelledAt: null, failedAt: null },
          { appliedAt: { gte: since } },
          { cancelledAt: { gte: since } },
          { failedAt: { gte: since } },
        ],
      },
      include: {
        author: { select: { user: { select: { fullName: true } } } },
        cancelledBy: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });
    const [halls, clubZone] = await Promise.all([
      this.prisma.hall.findMany({ where: { tenantId }, select: { id: true, timezone: true } }),
      clubTimezone(this.prisma, tenantId),
    ]);
    const zones = new Map(halls.map((hall) => [hall.id, hall.timezone]));

    return rows.map((row) => {
      const status: SettingsChangeStatus = row.appliedAt
        ? 'APPLIED'
        : row.cancelledAt
          ? 'CANCELLED'
          : row.failedAt
            ? 'FAILED'
            : 'PENDING';
      const payload = row.payload as Record<string, unknown>;
      const hallId = row.kind.startsWith('HALL_') ? row.targetId : typeof payload.hallId === 'string' ? payload.hallId : null;
      const data = (payload.data ?? {}) as Record<string, unknown>;
      // Пояс, по которому правка вставала в очередь: у нового зала — его
      // собственный, у удалённого — уже неизвестен, тогда клуба.
      const zone =
        row.kind === 'CLUB'
          ? clubZone
          : (zones.get(hallId ?? '') ?? (typeof data.timezone === 'string' ? data.timezone : clubZone));

      return {
        id: row.id,
        kind: row.kind,
        targetId: row.targetId,
        hallId,
        newName:
          typeof payload.label === 'string'
            ? payload.label
            : row.kind === 'HALL_CREATE' && typeof data.name === 'string'
              ? data.name
              : null,
        summary: row.summary,
        authorName: shortName(row.author.user.fullName),
        createdAt: row.createdAt.toISOString(),
        effectiveAt: row.effectiveAt.toISOString(),
        effectiveLabel: effectiveLabel(localParts(row.effectiveAt, zone).date),
        status,
        resolvedAt: (row.appliedAt ?? row.cancelledAt ?? row.failedAt)?.toISOString() ?? null,
        cancelledByName: row.cancelledBy ? shortName(row.cancelledBy.fullName) : null,
        failure: row.failure,
      };
    });
  }

  /**
   * Отмена до полуночи. Условным обновлением: правка, которую джоба уже
   * применяет, держится её транзакцией `FOR UPDATE`, и отмена дождётся её
   * и не совпадёт — «уже в силе», а не молчаливая отмена применённого.
   */
  async cancel(club: ClubContext, id: string): Promise<SettingsChange[]> {
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const cancelled = await tx.settingsChange.updateMany({
        where: { id, tenantId: club.tenantId, appliedAt: null, cancelledAt: null, failedAt: null },
        data: { cancelledAt: now, cancelledById: club.userId },
      });

      if (cancelled.count === 0) {
        const row = await tx.settingsChange.findFirst({ where: { id, tenantId: club.tenantId }, select: { appliedAt: true } });

        if (!row) {
          throw new NotFoundException('Правка не найдена');
        }

        throw new ConflictException(row.appliedAt ? 'Правка уже вступила в силу' : 'Правка уже отменена');
      }

      const row = await tx.settingsChange.findUniqueOrThrow({ where: { id }, select: { summary: true } });

      await this.notifier.settingsChanged(
        tx,
        club.tenantId,
        { ...(await this.heading(tx, club)), changes: row.summary, effective: '', cancelled: true },
        `settings:${id}:cancel`,
        now,
        [club.userId],
      );
    });

    return this.list(club.tenantId);
  }

  // --- Применение ----------------------------------------------------------

  /**
   * Применить наступившие правки, по порядку сохранения. `force` — все
   * запланированные клуба сразу: только для разработки и смоука, иначе
   * проверка настроек ждала бы полуночи.
   */
  async applyDue(options: { now?: Date; tenantId?: string; force?: boolean } = {}): Promise<{ applied: number; failed: number }> {
    const rows = await this.prisma.settingsChange.findMany({
      where: {
        appliedAt: null,
        cancelledAt: null,
        failedAt: null,
        ...(options.tenantId ? { tenantId: options.tenantId } : {}),
        ...(options.force ? {} : { effectiveAt: { lte: options.now ?? new Date() } }),
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    const result = { applied: 0, failed: 0 };

    for (const row of rows) {
      const outcome = await this.applyOne(row.id);

      if (outcome === 'applied') result.applied += 1;
      if (outcome === 'failed') result.failed += 1;
    }

    return result;
  }

  /**
   * Одна правка — одна транзакция: строка под `FOR UPDATE SKIP LOCKED`
   * (второй экземпляр API её пропустит), запись и отметка «применена». Не
   * вышло — отметка «не применилась» с причиной и сообщение персоналу.
   */
  private async applyOne(id: string): Promise<'applied' | 'failed' | 'skipped'> {
    try {
      const applied = await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "SettingsChange"
          WHERE id = ${id} AND "appliedAt" IS NULL AND "cancelledAt" IS NULL AND "failedAt" IS NULL
          FOR UPDATE SKIP LOCKED`;

        if (locked.length === 0) {
          return false;
        }

        const row = await tx.settingsChange.findUniqueOrThrow({ where: { id } });
        await this.write(tx, row.tenantId, row.kind, row.targetId, row.payload as Record<string, unknown>);
        await tx.settingsChange.update({ where: { id }, data: { appliedAt: new Date() } });

        return true;
      });

      return applied ? 'applied' : 'skipped';
    } catch (error) {
      const failure = failureOf(error);

      if (!(error instanceof ApplyProblem)) {
        this.logger.warn(`Правка настроек ${id} не применилась: ${error instanceof Error ? error.message : String(error)}`);
      }

      const now = new Date();

      await this.prisma.$transaction(async (tx) => {
        const marked = await tx.settingsChange.updateMany({
          where: { id, appliedAt: null, cancelledAt: null, failedAt: null },
          data: { failedAt: now, failure },
        });

        if (marked.count === 0) {
          return;
        }

        const row = await tx.settingsChange.findUniqueOrThrow({
          where: { id },
          select: { tenantId: true, summary: true, effectiveAt: true, authorId: true, tenant: { select: { name: true, slug: true } } },
        });
        const author = await tx.user.findUnique({ where: { id: row.authorId }, select: { fullName: true } });

        // Неудача — всем, и автору тоже: он думает, что правка в силе.
        await this.notifier.settingsChanged(
          tx,
          row.tenantId,
          {
            club: row.tenant.name,
            slug: row.tenant.slug,
            author: shortName(author?.fullName ?? ''),
            changes: row.summary,
            effective: '',
            failed: failure,
          },
          `settings:${id}:failed`,
          now,
          [],
        );
      });

      return 'failed';
    }
  }

  private async write(
    tx: Tx,
    tenantId: string,
    kind: SettingsChangeKind,
    targetId: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const target = targetId ?? '';

    switch (kind) {
      case 'CLUB':
        await tx.tenant.update({ where: { id: tenantId }, data: data as Prisma.TenantUpdateInput });
        return;

      case 'HALL_CREATE': {
        await tx.hall.create({ data: { ...(data as Omit<Prisma.HallUncheckedCreateInput, 'tenantId'>), id: target, tenantId } });
        const labels = defaultTableLabels(Number(payload.tableCount ?? 0));

        if (labels.length > 0) {
          await tx.table.createMany({ data: labels.map((label) => ({ tenantId, hallId: target, label })) });
        }
        return;
      }

      case 'HALL_UPDATE': {
        const updated = await tx.hall.updateMany({ where: { id: target, tenantId }, data: data as Prisma.HallUpdateManyMutationInput });

        if (updated.count === 0) {
          throw new ApplyProblem('Зала уже нет');
        }
        return;
      }

      case 'HALL_DELETE': {
        const [tables, halls] = await Promise.all([
          tx.table.count({ where: { hallId: target, tenantId } }),
          tx.hall.count({ where: { tenantId } }),
        ]);

        if (tables > 0) {
          throw new ApplyProblem('В зале остались столы — сначала уберите их');
        }

        if (halls <= 1) {
          throw new ApplyProblem('Это единственный зал клуба, удалить его нельзя');
        }

        // Приоритетный зал сотрудников снимается той же транзакцией: ключ на
        // зал RESTRICT (SET NULL обнулил бы и tenantId привязки), и без этого
        // зал, который кто-то выбрал основным, не удалялся бы вовсе.
        await tx.tenantMembership.updateMany({ where: { tenantId, preferredHallId: target }, data: { preferredHallId: null } });
        const deleted = await tx.hall.deleteMany({ where: { id: target, tenantId } });

        if (deleted.count === 0) {
          throw new ApplyProblem('Зала уже нет');
        }
        return;
      }

      case 'TABLE_CREATE':
        await tx.table.create({
          data: { id: target, tenantId, hallId: String(payload.hallId), label: String(payload.label) },
        });
        return;

      case 'TABLE_RENAME': {
        const renamed = await tx.table.updateMany({ where: { id: target, tenantId }, data: { label: String(payload.label) } });

        if (renamed.count === 0) {
          throw new ApplyProblem('Стола уже нет');
        }
        return;
      }

      case 'TABLE_DELETE': {
        const bookings = await tx.tableBooking.count({ where: { tableId: target } });

        if (bookings > 0) {
          throw new ApplyProblem('У стола появились брони — за ними стоят платежи, удалить его нельзя');
        }

        const deleted = await tx.table.deleteMany({ where: { id: target, tenantId } });

        if (deleted.count === 0) {
          throw new ApplyProblem('Стола уже нет');
        }
        return;
      }
    }
  }

  // --- Внутреннее ----------------------------------------------------------

  /**
   * Поставить правку в очередь и сообщить персоналу — одной транзакцией:
   * нет правки — нет и сообщения о ней.
   */
  private async enqueue(
    club: ClubContext,
    change: { kind: SettingsChangeKind; targetId: string | null; payload: object; summary: string[]; timezone: string },
  ): Promise<void> {
    const now = new Date();
    const date = nextDate(localParts(now, change.timezone).date);

    await this.prisma.$transaction(async (tx) => {
      const row = await tx.settingsChange.create({
        data: {
          tenantId: club.tenantId,
          kind: change.kind,
          targetId: change.targetId,
          payload: change.payload as Prisma.InputJsonObject,
          summary: change.summary,
          authorId: club.userId,
          effectiveAt: instantAt(date, 0, change.timezone),
        },
        select: { id: true },
      });

      await this.notifier.settingsChanged(
        tx,
        club.tenantId,
        { ...(await this.heading(tx, club)), changes: change.summary, effective: effectiveLabel(date) },
        `settings:${row.id}`,
        now,
        [club.userId],
      );
    });
  }

  /** Клуб и автор — шапка сообщения. */
  private async heading(tx: Tx, club: ClubContext): Promise<Pick<SettingsChangedPayload, 'club' | 'slug' | 'author'>> {
    const [tenant, user] = await Promise.all([
      tx.tenant.findUniqueOrThrow({ where: { id: club.tenantId }, select: { name: true, slug: true } }),
      tx.user.findUniqueOrThrow({ where: { id: club.userId }, select: { fullName: true } }),
    ]);

    return { club: tenant.name, slug: tenant.slug, author: shortName(user.fullName) };
  }

  /** Очередь клуба по порядку сохранения. */
  private async queue(tenantId: string): Promise<Queued[]> {
    const rows = await this.prisma.settingsChange.findMany({
      where: { tenantId, appliedAt: null, cancelledAt: null, failedAt: null },
      select: { id: true, kind: true, targetId: true, payload: true },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => ({ ...row, payload: row.payload as Record<string, unknown> }));
  }

  /** Названия залов после полуночи: id → название. */
  private async hallNames(tenantId: string, queue: Queued[]): Promise<Map<string, string>> {
    const halls = await this.prisma.hall.findMany({ where: { tenantId }, select: { id: true, name: true } });
    const names = new Map(halls.map((hall) => [hall.id, hall.name]));

    for (const item of queue) {
      const data = (item.payload.data ?? {}) as Record<string, unknown>;

      if (item.kind === 'HALL_CREATE' || (item.kind === 'HALL_UPDATE' && typeof data.name === 'string')) {
        names.set(item.targetId ?? '', String(data.name));
      } else if (item.kind === 'HALL_DELETE') {
        names.delete(item.targetId ?? '');
      }
    }

    return names;
  }

  private async hallTableLabels(tenantId: string, hallId: string, queue: Queued[]): Promise<Map<string, string>> {
    const tables = await this.prisma.table.findMany({ where: { tenantId, hallId }, select: { id: true, label: true } });

    return this.tableLabels(new Map(tables.map((table) => [table.id, table.label])), hallId, queue);
  }

  /** Столы зала после полуночи: id → название. */
  private tableLabels(current: Map<string, string>, hallId: string, queue: Queued[]): Map<string, string> {
    const labels = new Map(current);

    for (const item of queue) {
      if (item.payload.hallId !== hallId) {
        continue;
      }

      if (item.kind === 'TABLE_CREATE' || item.kind === 'TABLE_RENAME') {
        labels.set(item.targetId ?? '', String(item.payload.label));
      } else if (item.kind === 'TABLE_DELETE') {
        labels.delete(item.targetId ?? '');
      }
    }

    return labels;
  }

  private async table(tenantId: string, tableId: string) {
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, tenantId },
      select: {
        id: true,
        hallId: true,
        label: true,
        hall: { select: { name: true, timezone: true } },
        _count: { select: { bookings: true, closureRules: true, dayClosures: true } },
      },
    });

    if (!table) {
      throw new NotFoundException('Стол не найден');
    }

    return table;
  }

  /** Названия городов для сводки: «Город: Красноярск → Ачинск». */
  private async cityNames(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
    const wanted = ids.filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (wanted.length === 0) {
      return {};
    }

    const cities = await this.prisma.city.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } });

    return Object.fromEntries(cities.map((city) => [city.id, city.name]));
  }
}

/** «Зал «Пироги», час аренды: …» — строка сводки с залом. */
function inHall(hall: string, line: string): string {
  return `Зал «${hall}», ${line.charAt(0).toLowerCase()}${line.slice(1)}`;
}

/** Причина неудачи — людям, а не текст Postgres. */
function failureOf(error: unknown): string {
  if (error instanceof ApplyProblem) {
    return error.message;
  }

  if (error instanceof HttpException) {
    return error.message;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return 'Такое название уже занято';
    if (error.code === 'P2003') return 'На изменяемое уже ссылаются брони или расписание';
  }

  const text = error instanceof Error ? error.message : '';

  return /23514|check constraint/i.test(text)
    ? 'Правка противоречит текущим настройкам клуба'
    : 'Не удалось применить правку';
}

/** Русское склонение по числу: 1 стол, 2 стола, 5 столов. */
function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;

  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;

  return many;
}

