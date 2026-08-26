import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@yenisey/database';
import type {
  ClosureException,
  ClosureExceptionRequest,
  ClosureRule,
  ClosureRuleDraft,
  ClubClosures,
  Weekday,
} from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';
import { findOverlap, formatMinutes } from './closures';

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

@Injectable()
export class ClosuresService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string): Promise<ClubClosures> {
    const [rules, exceptions] = await Promise.all([
      this.prisma.tableClosureRule.findMany({
        where: { tenantId },
        select: { id: true, tableId: true, weekday: true, startMinute: true, endMinute: true },
        orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
      }),
      this.prisma.tableClosure.findMany({
        where: { tenantId },
        select: { id: true, tableId: true, startsAt: true, endsAt: true, reason: true },
        orderBy: { startsAt: 'asc' },
      }),
    ]);

    return {
      rules: rules.map((rule) => ({ ...rule, weekday: rule.weekday as Weekday })),
      exceptions: exceptions.map(toException),
    };
  }

  /**
   * Замена всего недельного расписания разом.
   *
   * Не поштучное добавление и удаление: администратор правит расписание в
   * сетке, где одно движение мыши закрывает десяток окон. Считать разницу на
   * клиенте и надеяться, что она сошлась, — лишний источник расхождений.
   *
   * Удаление и вставка идут одной транзакцией: расписание, обнулённое на
   * полпути, означало бы, что клуб на мгновение открыл клиентам всё подряд.
   */
  async replaceRules(tenantId: string, rules: ClosureRuleDraft[]): Promise<ClosureRule[]> {
    await this.assertTablesBelongToTenant(
      tenantId,
      rules.map((rule) => rule.tableId),
    );

    const overlap = findOverlap(rules);

    if (overlap) {
      // Та же проверка стоит exclusion-констрейнтом в базе, и последнее слово
      // за ней. Здесь она повторена ради сообщения: администратор должен
      // увидеть, какие именно окна конфликтуют.
      const [first, second] = overlap;

      throw new BadRequestException(
        `Два окна одного стола накладываются друг на друга в ${WEEKDAY_NAMES[first.weekday]}: ` +
          `${formatMinutes(first.startMinute)}–${formatMinutes(first.endMinute)} и ` +
          `${formatMinutes(second.startMinute)}–${formatMinutes(second.endMinute)}`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.tableClosureRule.deleteMany({ where: { tenantId } }),
      this.prisma.tableClosureRule.createMany({
        data: rules.map((rule) => ({ ...rule, tenantId })),
      }),
    ]);

    return (await this.findAll(tenantId)).rules;
  }

  async createException(
    tenantId: string,
    dto: ClosureExceptionRequest,
  ): Promise<ClosureException> {
    await this.assertTablesBelongToTenant(tenantId, [dto.tableId]);

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);

    if (endsAt.getTime() <= startsAt.getTime()) {
      throw new BadRequestException('Конец окна должен быть позже начала');
    }

    try {
      const created = await this.prisma.tableClosure.create({
        data: { tenantId, tableId: dto.tableId, startsAt, endsAt, reason: dto.reason ?? null },
        select: { id: true, tableId: true, startsAt: true, endsAt: true, reason: true },
      });

      return toException(created);
    } catch (error) {
      // У этого стола уже закрыто пересекающееся время — сработал
      // exclusion-констрейнт (см. isExclusionViolation ниже).
      if (isExclusionViolation(error)) {
        throw new ConflictException('У этого стола уже закрыто пересекающееся время');
      }

      throw error;
    }
  }

  async deleteException(tenantId: string, id: string): Promise<void> {
    // tenantId в условии обязателен, хотя id и так уникален: иначе
    // администратор одного клуба снял бы блокировку в другом.
    const deleted = await this.prisma.tableClosure.deleteMany({ where: { id, tenantId } });

    if (deleted.count === 0) {
      throw new NotFoundException('Окно не найдено');
    }
  }

  /**
   * Все столы из запроса принадлежат этому клубу.
   *
   * Составной внешний ключ (tableId, tenantId) не дал бы записать чужой стол и
   * сам, но отдал бы это ошибкой базы. Проверка здесь — ради внятного ответа.
   */
  private async assertTablesBelongToTenant(tenantId: string, tableIds: string[]): Promise<void> {
    const unique = [...new Set(tableIds)];

    if (unique.length === 0) {
      return;
    }

    const found = await this.prisma.table.count({
      where: { tenantId, id: { in: unique } },
    });

    if (found !== unique.length) {
      throw new BadRequestException('В расписании указан стол, которого нет в этом клубе');
    }
  }
}

function toException(row: {
  id: string;
  tableId: string;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
}): ClosureException {
  return {
    id: row.id,
    tableId: row.tableId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    reason: row.reason,
  };
}

/**
 * Нарушение exclusion-констрейнта Postgres (SQLSTATE 23P01).
 *
 * У Prisma для него нет собственного кода: запрос падает
 * `PrismaClientUnknownRequestError`, и SQLSTATE лежит внутри текста. Поэтому
 * ищем именно код, а не формулировку, — сообщение приходит на языке сервера
 * базы и на другой машине будет другим.
 */
function isExclusionViolation(error: unknown): boolean {
  const isPrismaError =
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientKnownRequestError;

  return isPrismaError && error.message.includes('23P01');
}
