import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ClosureRule,
  ClosureRuleDraft,
  ClosureSlot,
  DayClosure,
  DayClosureDraft,
  DaySchedule,
  Weekday,
} from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';
import { findOverlap, formatMinutes, ruleGroupKey, slotViolations } from './closures';

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
  constructor(private readonly prisma: PrismaService) {}

  // --- Шаблон недели -------------------------------------------------------

  async findTemplate(tenantId: string, hallId: string): Promise<ClosureRule[]> {
    await this.assertHall(tenantId, hallId);

    const rules = await this.prisma.tableClosureRule.findMany({
      where: { tenantId, table: { hallId } },
      select: { ...SLOT_SELECT, weekday: true },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
    });

    return rules.map((rule) => ({ ...rule, weekday: rule.weekday as Weekday }));
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
    await this.assertTablesInHall(tenantId, hallId, rules);
    this.assertSlotsValid(rules);
    this.assertNoOverlap(rules, ruleGroupKey, (rule) => ` в ${WEEKDAY_NAMES[rule.weekday]}`);

    const tableIds = await this.hallTableIds(tenantId, hallId);

    await this.prisma.$transaction([
      // Гасится расписание ТОЛЬКО этого зала: у соседнего своё, и трогать его
      // правка одного зала не должна.
      this.prisma.tableClosureRule.deleteMany({ where: { tenantId, tableId: { in: tableIds } } }),
      this.prisma.tableClosureRule.createMany({
        data: rules.map((rule) => ({ ...rule, tenantId })),
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
      select: { closures: { select: SLOT_SELECT, orderBy: { startMinute: 'asc' } } },
    });

    return {
      date,
      customised: schedule !== null,
      closures: schedule?.closures ?? [],
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
    await this.assertTablesInHall(tenantId, hallId, closures);
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

      await tx.dayClosure.deleteMany({ where: { scheduleId: schedule.id } });
      await tx.dayClosure.createMany({
        data: closures.map((closure) => ({ ...closure, tenantId, scheduleId: schedule.id })),
      });
    });

    return this.findDay(tenantId, hallId, date);
  }

  /** Возврат даты к шаблону: заголовок дня убирается, окна уходят каскадом. */
  async resetDay(tenantId: string, hallId: string, date: string): Promise<DaySchedule> {
    await this.assertHall(tenantId, hallId);

    await this.prisma.hallDaySchedule.deleteMany({
      where: { tenantId, hallId, date: parseDate(date) },
    });

    return this.findDay(tenantId, hallId, date);
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

  private assertSlotsValid(slots: readonly ClosureSlot[]): void {
    const violations = slots.flatMap((slot) => slotViolations(slot));

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
