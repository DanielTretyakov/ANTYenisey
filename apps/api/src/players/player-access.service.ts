import { Injectable } from '@nestjs/common';
import { Role } from '@yenisey/database';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Кем смотрящий приходится игроку — то, что правилам видимости
 * (`player-rules.ts`) нужно узнать из базы.
 */
@Injectable()
export class PlayerAccess {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Администратор или руководство хотя бы одного клуба, где игрок состоит.
   *
   * Оба членства — действующие: ушедший из клуба игрок больше не забота этого
   * клуба, а уволенный администратор не видит сканов приказов вовсе.
   */
  async managesOwner(viewerId: string | null, ownerId: string): Promise<boolean> {
    if (!viewerId || viewerId === ownerId) {
      return false;
    }

    const found = await this.prisma.tenantMembership.findFirst({
      where: {
        userId: viewerId,
        deactivatedAt: null,
        role: { in: [Role.ADMIN, Role.OWNER] },
        tenant: { memberships: { some: { userId: ownerId, deactivatedAt: null } } },
      },
      select: { tenantId: true },
    });

    return found !== null;
  }
}
