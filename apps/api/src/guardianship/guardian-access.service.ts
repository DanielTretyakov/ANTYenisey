import { Injectable } from '@nestjs/common';
import { GuardianshipStatus } from '@yenisey/database';
import { PrismaService } from '../prisma/prisma.service';
import { guardianHasRights } from './guardianship-rules';

/**
 * Кто чей родитель — то, что правилам семьи (`guardianship-rules.ts`) нужно
 * узнать из базы.
 *
 * Отдельно от FamilyService: к этим вопросам обращаются запись и отмена за
 * ребёнка, профиль игрока и раздача файлов, — а заводить учётки и отвечать на
 * заявки им не нужно.
 */
@Injectable()
export class GuardianAccess {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ведёт ли `guardianId` ребёнка `childId` прямо сейчас: опека действует и
   * ребёнку нет 14. Отключённый и анонимизированный ребёнок не ведётся —
   * записывать его некуда.
   */
  async hasRights(guardianId: string | null, childId: string, today = new Date()): Promise<boolean> {
    if (!guardianId || guardianId === childId) {
      return false;
    }

    const found = await this.prisma.guardianship.findFirst({
      where: {
        guardianUserId: guardianId,
        childUserId: childId,
        status: GuardianshipStatus.ACTIVE,
        child: { deactivatedAt: null, anonymizedAt: null },
      },
      select: { status: true, child: { select: { birthDate: true } } },
    });

    return found !== null && guardianHasRights(found.status, found.child.birthDate, today);
  }

  /** Действующая опека над ребёнком — для решения «за кого» и карточки. */
  activeOf(childId: string) {
    return this.prisma.guardianship.findFirst({
      where: { childUserId: childId, status: GuardianshipStatus.ACTIVE },
      select: {
        id: true,
        status: true,
        guardianUserId: true,
        guardian: { select: { id: true, fullName: true } },
        child: { select: { birthDate: true } },
      },
    });
  }
}
