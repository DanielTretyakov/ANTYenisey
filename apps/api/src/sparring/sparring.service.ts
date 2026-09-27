import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@yenisey/database';
import type { SparringStudent, SparringType, SparringTypeRequest } from '@yenisey/types';
import { fullYears } from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';
import { parseSparringType } from './sparring-rules';

const TYPE_SELECT = {
  id: true,
  name: true,
  hourPrice: true,
  minAge: true,
  maxAge: true,
  description: true,
  isActive: true,
} as const satisfies Prisma.SparringTypeSelect;

/**
 * Конструктор типов спаррингов (решение владельца от 26.09.2026) и поиск
 * ученика для тренера.
 *
 * Правка типа действует сразу, как правка вида занятия в каталоге: цена брони
 * снимается копией в момент брони, и новая цена старые спарринги не трогает.
 * Удаления нет — на тип ссылаются брони; снятый с продажи тип тренеру не
 * предлагается.
 */
@Injectable()
export class SparringService {
  constructor(private readonly prisma: PrismaService) {}

  /** Все типы клуба: действующие сверху, внутри — по названию. */
  async list(tenantId: string): Promise<SparringType[]> {
    return this.prisma.sparringType.findMany({
      where: { tenantId },
      select: TYPE_SELECT,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async create(tenantId: string, dto: SparringTypeRequest): Promise<SparringType> {
    const value = parsed(dto);

    return this.unique(() =>
      this.prisma.sparringType.create({ data: { tenantId, ...value }, select: TYPE_SELECT }),
    );
  }

  async update(tenantId: string, id: string, dto: SparringTypeRequest): Promise<SparringType> {
    const value = parsed(dto);
    const { count } = await this.unique(() =>
      this.prisma.sparringType.updateMany({ where: { id, tenantId }, data: value }),
    );

    if (count === 0) {
      throw new NotFoundException('Тип спарринга не найден');
    }

    return this.prisma.sparringType.findUniqueOrThrow({ where: { id }, select: TYPE_SELECT });
  }

  /**
   * Ученик для спарринга — поиск тренера по ФИО среди людей клуба.
   *
   * Полное имя и возраст: тренеру ученику звонить (как в составе групп) и
   * выбирать тип по возрасту. Не больше десятка строк и от двух букв — это
   * поиск нужного человека, а не выгрузка клуба.
   */
  async students(tenantId: string, coachId: string, search: string, limit = 10): Promise<SparringStudent[]> {
    const rows = await this.prisma.tenantMembership.findMany({
      where: {
        tenantId,
        deactivatedAt: null,
        userId: { not: coachId },
        user: {
          deactivatedAt: null,
          anonymizedAt: null,
          fullName: { contains: search.trim(), mode: 'insensitive' },
        },
      },
      select: { userId: true, user: { select: { fullName: true, birthDate: true } } },
      orderBy: { user: { fullName: 'asc' } },
      take: Math.min(limit, 20),
    });

    const today = new Date();

    return rows.map((row) => ({
      id: row.userId,
      fullName: row.user.fullName,
      age: fullYears(row.user.birthDate, today),
    }));
  }

  /** Название уникально в клубе — P2002 внятным ответом, а не 500. */
  private async unique<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Тип спарринга с таким названием в клубе уже есть');
      }

      throw error;
    }
  }
}

function parsed(dto: SparringTypeRequest) {
  const result = parseSparringType(dto);

  if (!result.ok) {
    throw new BadRequestException(result.message);
  }

  return result.value;
}
