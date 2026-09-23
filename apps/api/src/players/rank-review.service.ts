import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, AuditAction } from '@yenisey/database';
import type { PlayerProfile } from '@yenisey/types';
import { ClientNotifier } from '../notifications/client-notifier.service';
import { PrismaService } from '../prisma/prisma.service';
import type { RankReviewDto } from './dto/player.dto';
import { decideRankReview } from './player-rules';
import { PlayersService, RANK_SELECT, rankState } from './players.service';

const STALE = 'Разряд изменился, пока вы смотрели карточку, — откройте её заново и решите ещё раз';

/**
 * Проверка разряда клубом.
 *
 * Подтверждает администратор любого клуба, где человек состоит, и решение
 * действует на всей платформе с подписью этого клуба. Пересмотреть его может
 * любой клуб игрока — с причиной; последнее слово за последним, и каждое
 * решение ложится в журнал аудита того клуба, который его принял (решения
 * владельца от 12.09.2026).
 */
@Injectable()
export class RankReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly players: PlayersService,
    private readonly notifier: ClientNotifier,
  ) {}

  async review(
    tenantId: string,
    playerId: string,
    dto: RankReviewDto,
    actor: { userId: string; ipAddress: string | null },
  ): Promise<PlayerProfile> {
    // Игрок обязан состоять в этом клубе — и не быть из него отключённым.
    // Иначе администратор любого клуба платформы подписывал бы разряды людей,
    // которых никогда не видел.
    const member = await this.prisma.tenantMembership.findFirst({
      where: { tenantId, userId: playerId, deactivatedAt: null, user: { anonymizedAt: null } },
      select: { userId: true },
    });

    if (!member) {
      throw new NotFoundException('Человек не найден в этом клубе');
    }

    const seen = new Date(dto.version);

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.sportRank.findUnique({ where: { userId: playerId }, select: RANK_SELECT });

      if (!current) {
        throw new NotFoundException('Разряд не указан');
      }

      if (current.updatedAt.getTime() !== seen.getTime()) {
        throw new ConflictException(STALE);
      }

      const reason = dto.reason?.trim() || null;
      const decision = decideRankReview(rankState(current), {
        decision: dto.decision,
        reason,
        reviewerId: actor.userId,
        playerId,
      });

      if (!decision.ok) {
        throw decision.status === 403
          ? new ForbiddenException(decision.message)
          : new BadRequestException(decision.message);
      }

      if (!decision.changed) {
        return;
      }

      // Условие по версии — в самом обновлении: между чтением выше и этой
      // строкой игрок мог поправить разряд, а второй администратор — принять
      // своё решение. Проверка «прочитал — сравнил» без него гонку не ловит.
      const updated = await tx.sportRank.updateMany({
        where: { userId: playerId, updatedAt: current.updatedAt },
        data: {
          status: dto.decision,
          reviewedByUserId: actor.userId,
          reviewedInTenantId: tenantId,
          reviewedAt: new Date(),
          rejectionReason: decision.rejectionReason,
        },
      });

      if (updated.count === 0) {
        throw new ConflictException(STALE);
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          action: dto.decision === 'VERIFIED' ? AuditAction.RANK_VERIFIED : AuditAction.RANK_REJECTED,
          actorType: ActorType.USER,
          actorUserId: actor.userId,
          entityType: 'SportRank',
          entityId: playerId,
          before: { status: current.status, rank: current.rank },
          after: { status: dto.decision, rank: current.rank },
          reason: decision.auditReason,
          ipAddress: actor.ipAddress,
        },
      });

      await this.notifier.rankDecided(tx, tenantId, playerId);
    });

    return this.players.profile(playerId);
  }
}
