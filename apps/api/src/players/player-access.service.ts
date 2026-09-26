import { Injectable } from '@nestjs/common';
import { Role } from '@yenisey/database';
import { GuardianAccess } from '../guardianship/guardian-access.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ProfileViewer } from './player-rules';

/**
 * Кем смотрящий приходится игроку — то, что правилам видимости
 * (`player-rules.ts`) нужно узнать из базы.
 */
@Injectable()
export class PlayerAccess {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guardians: GuardianAccess,
  ) {}

  /** Кто смотрит: сам, родитель, администратор его клуба — или посторонний. */
  async viewerOf(viewerId: string | null, ownerId: string): Promise<ProfileViewer> {
    const [managesOwner, guardsOwner] = await Promise.all([
      this.managesOwner(viewerId, ownerId),
      this.guardians.hasRights(viewerId, ownerId),
    ]);

    return { viewerId, managesOwner, guardsOwner };
  }

  /**
   * Администратор или руководство хотя бы одного клуба, где игрок состоит.
   *
   * Оба членства — действующие: ушедший из клуба игрок больше не забота этого
   * клуба, а уволенный администратор не видит сканов приказов вовсе.
   */
  private async managesOwner(viewerId: string | null, ownerId: string): Promise<boolean> {
    if (!viewerId || viewerId === ownerId) {
      return false;
    }

    const found = await this.prisma.tenantMembership.findFirst({
      where: {
        userId: viewerId,
        deactivatedAt: null,
        roles: { hasSome: [Role.ADMIN, Role.MANAGER, Role.OWNER] },
        tenant: { memberships: { some: { userId: ownerId, deactivatedAt: null } } },
      },
      select: { tenantId: true },
    });

    return found !== null;
  }
}
