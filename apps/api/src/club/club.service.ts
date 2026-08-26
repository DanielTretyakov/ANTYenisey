import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@yenisey/database';
import type { ClubSettings, ClubTable, UpdateClubSettingsRequest } from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';
import { settingsViolations } from './settings-rules';

/**
 * Поля Tenant, составляющие профиль клуба. Выбираются явным списком, а не
 * целой моделью: рядом лежит служебное (id, отметки времени, связи), которое
 * администратору отдавать незачем.
 */
const SETTINGS_SELECT = {
  name: true,
  timezone: true,
  bookingStep: true,
  tableHourPrice: true,
  tableExtra30MinPrice: true,
  hasRobotOption: true,
  robot30MinPrice: true,
  robot60MinPrice: true,
  robotExtra30MinPrice: true,
  noShowChargePercent: true,
  attendanceReminderAfterMinutes: true,
  attendanceAutoNoShowAfterMinutes: true,
  subscriptionBurnsOnNoShowOnly: true,
} as const;

@Injectable()
export class ClubService {
  constructor(private readonly prisma: PrismaService) {}

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
   * Проверять приходится слитое состояние, а не пришедшие поля: включение
   * опции робота одним запросом и задание цен другим — законный сценарий
   * формы, и «цены заданы» проверяется только на объединении нового со
   * старым.
   */
  async updateSettings(
    tenantId: string,
    patch: UpdateClubSettingsRequest,
  ): Promise<ClubSettings> {
    const current = await this.findSettings(tenantId);
    const merged: ClubSettings = { ...current, ...patch };

    const violations = settingsViolations(merged);

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

  /** Столы клуба в порядке названия — так их видит и администратор, и клиент. */
  async listTables(tenantId: string): Promise<ClubTable[]> {
    const tables = await this.prisma.table.findMany({
      where: { tenantId },
      select: { id: true, label: true, _count: { select: { bookings: true } } },
      orderBy: { label: 'asc' },
    });

    return tables.map((table) => ({
      id: table.id,
      label: table.label,
      hasBookings: table._count.bookings > 0,
    }));
  }

  async createTable(tenantId: string, label: string): Promise<ClubTable> {
    try {
      const created = await this.prisma.table.create({
        data: { tenantId, label },
        select: { id: true, label: true },
      });

      return { ...created, hasBookings: false };
    } catch (error) {
      throw this.translateTableError(error, label);
    }
  }

  async renameTable(tenantId: string, tableId: string, label: string): Promise<ClubTable> {
    // tenantId в условии обязателен, хотя id и так уникален: иначе
    // администратор одного клуба переименовал бы стол другого, подставив
    // чужой идентификатор.
    const updated = await this.prisma.table
      .updateMany({ where: { id: tableId, tenantId }, data: { label } })
      .catch((error: unknown) => {
        throw this.translateTableError(error, label);
      });

    if (updated.count === 0) {
      throw new NotFoundException('Стол не найден');
    }

    const table = await this.prisma.table.findFirstOrThrow({
      where: { id: tableId, tenantId },
      select: { id: true, label: true, _count: { select: { bookings: true } } },
    });

    return { id: table.id, label: table.label, hasBookings: table._count.bookings > 0 };
  }

  /**
   * Удаление стола.
   *
   * Стол с бронями удалить нельзя: за бронями висят платежи, нужные
   * бухгалтерии, и внешний ключ стоит на `Restrict`. Проверка здесь — ради
   * внятного ответа; последнее слово всё равно за базой, потому что между
   * проверкой и удалением бронь может появиться.
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

  /** P2002 — нарушение @@unique([tenantId, label]): такое название уже занято. */
  private translateTableError(error: unknown, label: string): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException(`Стол «${label}» в клубе уже есть`);
    }

    return error;
  }
}
