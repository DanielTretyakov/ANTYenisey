import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@yenisey/database';
import type {
  ClubCoach,
  ClubSettings,
  ClubTable,
  CreateHallRequest,
  Hall,
  UpdateClubSettingsRequest,
  UpdateHallRequest,
} from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';
import { clubSettingsViolations, hallViolations } from './settings-rules';

/**
 * Поля Tenant, составляющие профиль клуба. Выбираются явным списком, а не
 * целой моделью: рядом лежит служебное (id, отметки времени, связи), которое
 * администратору отдавать незачем.
 */
const SETTINGS_SELECT = {
  name: true,
  timezone: true,
  noShowChargePercent: true,
  attendanceReminderAfterMinutes: true,
  attendanceAutoNoShowAfterMinutes: true,
  subscriptionBurnsOnNoShowOnly: true,
} as const;

const HALL_SELECT = {
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

@Injectable()
export class ClubService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Настройки клуба -----------------------------------------------------

  async findSettings(tenantId: string): Promise<ClubSettings> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: SETTINGS_SELECT,
    });

    if (!tenant) {
      throw new NotFoundException('Клуб не найден');
    }

    return tenant;
  }

  /**
   * Частичная правка настроек.
   *
   * Проверять приходится слитое состояние, а не пришедшие поля: сдвинуть срок
   * напоминания одним запросом, а срок автонеявки другим — законный сценарий
   * формы, и «одно позже другого» проверяется только на объединении нового со
   * старым.
   */
  async updateSettings(
    tenantId: string,
    patch: UpdateClubSettingsRequest,
  ): Promise<ClubSettings> {
    const current = await this.findSettings(tenantId);
    const violations = clubSettingsViolations({ ...current, ...defined(patch) });

    if (violations.length > 0) {
      // Те же правила закреплены CHECK-констрейнтами в базе. Здесь они
      // повторены не ради надёжности, а ради формулировки: без этой проверки
      // администратор получил бы 500 и текст ошибки Postgres.
      throw new BadRequestException(violations);
    }

    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: patch,
      select: SETTINGS_SELECT,
    });
  }

  // --- Залы ----------------------------------------------------------------

  listHalls(tenantId: string): Promise<Hall[]> {
    return this.prisma.hall.findMany({
      where: { tenantId },
      select: HALL_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  async createHall(tenantId: string, dto: CreateHallRequest): Promise<Hall> {
    const violations = hallViolations(dto);

    if (violations.length > 0) {
      throw new BadRequestException(violations);
    }

    try {
      return await this.prisma.hall.create({
        data: { ...dto, name: dto.name.trim(), tenantId },
        select: HALL_SELECT,
      });
    } catch (error) {
      throw this.translateHallError(error, dto.name);
    }
  }

  async updateHall(tenantId: string, hallId: string, patch: UpdateHallRequest): Promise<Hall> {
    const current = await this.findHall(tenantId, hallId);
    const violations = hallViolations({ ...current, ...defined(patch) });

    if (violations.length > 0) {
      throw new BadRequestException(violations);
    }

    try {
      // tenantId в условии обязателен, хотя id и так уникален: иначе
      // администратор одного клуба правил бы зал другого, подставив чужой
      // идентификатор.
      await this.prisma.hall.updateMany({
        where: { id: hallId, tenantId },
        data: patch.name === undefined ? patch : { ...patch, name: patch.name.trim() },
      });
    } catch (error) {
      throw this.translateHallError(error, patch.name ?? current.name);
    }

    return this.findHall(tenantId, hallId);
  }

  /**
   * Удаление зала.
   *
   * Зал со столами удалить нельзя: за столами стоят брони и расписание, и
   * каскад унёс бы их молча. Сначала админ убирает столы — тогда он видит,
   * сколько всего теряет.
   */
  async deleteHall(tenantId: string, hallId: string): Promise<void> {
    const [hall, tables, halls] = await Promise.all([
      this.prisma.hall.findFirst({ where: { id: hallId, tenantId }, select: { id: true } }),
      this.prisma.table.count({ where: { hallId, tenantId } }),
      this.prisma.hall.count({ where: { tenantId } }),
    ]);

    if (!hall) {
      throw new NotFoundException('Зал не найден');
    }

    if (tables > 0) {
      throw new ConflictException(
        `В зале ${tables} ${plural(tables, 'стол', 'стола', 'столов')} — сначала уберите их`,
      );
    }

    // Клуб без единого зала не может ни назначить цену, ни завести стол:
    // настройки аренды живут только у зала.
    if (halls <= 1) {
      throw new ConflictException('Это единственный зал клуба, удалить его нельзя');
    }

    await this.prisma.hall.delete({ where: { id: hallId } });
  }

  private async findHall(tenantId: string, hallId: string): Promise<Hall> {
    const hall = await this.prisma.hall.findFirst({
      where: { id: hallId, tenantId },
      select: HALL_SELECT,
    });

    if (!hall) {
      throw new NotFoundException('Зал не найден');
    }

    return hall;
  }

  // --- Столы ---------------------------------------------------------------

  /**
   * Столы клуба в порядке зала и названия.
   *
   * Вместе с каждым столом едет число окон занятого времени: удаление стола
   * унесёт их каскадом, и администратор должен увидеть это ДО нажатия, а не
   * обнаружить пропажу расписания после.
   */
  async listTables(tenantId: string): Promise<ClubTable[]> {
    const tables = await this.prisma.table.findMany({
      where: { tenantId },
      select: {
        id: true,
        hallId: true,
        label: true,
        _count: { select: { bookings: true, closureRules: true, dayClosures: true } },
      },
      orderBy: [{ hallId: 'asc' }, { label: 'asc' }],
    });

    return tables.map((table) => ({
      id: table.id,
      hallId: table.hallId,
      label: table.label,
      hasBookings: table._count.bookings > 0,
      closureCount: table._count.closureRules + table._count.dayClosures,
    }));
  }

  async createTable(tenantId: string, hallId: string, label: string): Promise<ClubTable> {
    // Зал проверяется отдельно: составной внешний ключ не дал бы записать
    // чужой зал и сам, но отдал бы это ошибкой базы.
    await this.findHall(tenantId, hallId);

    try {
      const created = await this.prisma.table.create({
        data: { tenantId, hallId, label },
        select: { id: true, hallId: true, label: true },
      });

      return { ...created, hasBookings: false, closureCount: 0 };
    } catch (error) {
      throw this.translateTableError(error, label);
    }
  }

  async renameTable(tenantId: string, tableId: string, label: string): Promise<ClubTable> {
    const updated = await this.prisma.table
      .updateMany({ where: { id: tableId, tenantId }, data: { label } })
      .catch((error: unknown) => {
        throw this.translateTableError(error, label);
      });

    if (updated.count === 0) {
      throw new NotFoundException('Стол не найден');
    }

    const tables = await this.listTables(tenantId);
    const table = tables.find((item) => item.id === tableId);

    if (!table) {
      throw new NotFoundException('Стол не найден');
    }

    return table;
  }

  /**
   * Удаление стола.
   *
   * Стол с бронями удалить нельзя: за бронями висят платежи, нужные
   * бухгалтерии, и внешний ключ стоит на `Restrict`. Проверка здесь — ради
   * внятного ответа; последнее слово всё равно за базой, потому что между
   * проверкой и удалением бронь может появиться.
   *
   * Окна занятого времени удалению не мешают и уходят каскадом — их число
   * администратор видел в списке столов до нажатия.
   */
  async deleteTable(tenantId: string, tableId: string): Promise<void> {
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, tenantId },
      select: { id: true, _count: { select: { bookings: true } } },
    });

    if (!table) {
      throw new NotFoundException('Стол не найден');
    }

    if (table._count.bookings > 0) {
      throw new ConflictException(
        'У стола есть брони, поэтому удалить его нельзя — за бронями стоят платежи',
      );
    }

    try {
      await this.prisma.table.delete({ where: { id: tableId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException(
          'У стола есть брони, поэтому удалить его нельзя — за бронями стоят платежи',
        );
      }
      throw error;
    }
  }

  // --- Тренеры -------------------------------------------------------------

  /**
   * Тренеры клуба — для выбора при назначении тренировки.
   *
   * Отключённые и анонимизированные не показываются: назначить уволенного
   * тренера на будущее занятие нельзя, а уже назначенные записи остаются —
   * внешний ключ стоит на `Restrict`, и история не переписывается.
   */
  async listCoaches(tenantId: string): Promise<ClubCoach[]> {
    const coaches = await this.prisma.user.findMany({
      where: {
        tenantId,
        role: Role.COACH,
        deactivatedAt: null,
        anonymizedAt: null,
        coachProfile: { isNot: null },
      },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });

    return coaches.map((coach) => ({ id: coach.id, fullName: coach.fullName }));
  }

  // --- Разбор ошибок базы --------------------------------------------------

  /** P2002 — нарушение @@unique([hallId, label]): такое название уже занято. */
  private translateTableError(error: unknown, label: string): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException(`Стол «${label}» в этом зале уже есть`);
    }

    return error;
  }

  private translateHallError(error: unknown, name: string): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException(`Зал «${name}» в клубе уже есть`);
    }

    return error;
  }
}

/**
 * Поля, которые в правке действительно пришли.
 *
 * Класс DTO объявляет все поля, и незаданные приходят как `undefined`. При
 * слиянии `{ ...current, ...patch }` такое поле затирает текущее значение
 * пустотой — и проверка видит зал без названия там, где меняли одну цену.
 * Prisma `undefined` игнорирует сама, а вот перекрёстные правила — нет.
 */
function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
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
