import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@yenisey/database';
import { shortName, type FavouriteCoach } from '@yenisey/types';
import { nextSessionPerCoach } from '../events/coach-sessions';
import { PrismaService } from '../prisma/prisma.service';

/**
 * «Мои тренеры» — избранные тренеры человека (решение владельца от
 * 02.10.2026).
 *
 * Это закладка, а не принадлежность: предела нет, подтверждения нет, тренер
 * не видит, кто его отметил. Отметить можно только того, кто сейчас
 * тренирует хоть в одном клубе, — иначе на кнопку «в избранное» можно было
 * бы прислать любой id учётки и получить в ответ имя её владельца.
 */
@Injectable()
export class FavouriteCoachesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Мои тренеры в порядке отметки, у каждого — ближайшее занятие. */
  async list(userId: string): Promise<FavouriteCoach[]> {
    const rows = await this.prisma.userCoach.findMany({
      where: { userId, coach: { deactivatedAt: null, anonymizedAt: null } },
      select: {
        coach: {
          select: {
            id: true,
            fullName: true,
            gender: true,
            coachCard: { select: { photoFileId: true } },
            memberships: {
              where: ACTIVE_COACHING,
              select: { tenant: { select: { slug: true, name: true, accentColor: true } } },
              orderBy: { tenant: { name: 'asc' } },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const next = await nextSessionPerCoach(
      this.prisma,
      rows.map((row) => row.coach.id),
      userId,
    );

    return rows.map(({ coach }) => ({
      id: coach.id,
      name: shortName(coach.fullName),
      photoFileId: coach.coachCard?.photoFileId ?? null,
      gender: coach.gender,
      clubs: coach.memberships.map((membership) => membership.tenant),
      next: next.get(coach.id) ?? null,
    }));
  }

  /**
   * Отметить тренера. PUT: повторная отметка — не ошибка, кнопка могла
   * сработать дважды.
   */
  async add(userId: string, coachId: string): Promise<FavouriteCoach[]> {
    if (coachId === userId) {
      throw new BadRequestException('Себя в избранные тренеры не отмечают');
    }

    const coaching = await this.prisma.tenantMembership.findFirst({
      where: { userId: coachId, ...ACTIVE_COACHING, user: { deactivatedAt: null, anonymizedAt: null } },
      select: { userId: true },
    });

    if (!coaching) {
      throw new NotFoundException('Тренер не найден');
    }

    try {
      await this.prisma.userCoach.create({ data: { userId, coachId } });
    } catch (error) {
      // Уже отмечен — тот же результат, что у первой отметки.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw error;
      }
    }

    return this.list(userId);
  }

  /** Снять отметку. Ушедшего отовсюду тренера тоже можно снять. */
  async remove(userId: string, coachId: string): Promise<FavouriteCoach[]> {
    await this.prisma.userCoach.deleteMany({ where: { userId, coachId } });

    return this.list(userId);
  }
}

/** Тренирует сейчас: роль тренера в действующем членстве и заведённые цены. */
const ACTIVE_COACHING = {
  roles: { has: Role.COACH },
  deactivatedAt: null,
  coachProfile: { isNot: null },
} as const;
