import { randomBytes } from 'node:crypto';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MaxLinkResponse } from '@yenisey/types';
import { hashToken } from '../auth/tokens';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { MaxTransport } from './max.transport';
import { LINK_TOKEN_TTL_MS } from './notification-rules';

/** Чем кончилась привязка по ссылке. */
export type ConsumeResult =
  | { ok: true; fullName: string; replaced: boolean }
  | { ok: false };

/**
 * Привязка учётки к MAX.
 *
 * Человек нажимает на сайте «Подключить MAX» и получает ссылку
 * max.ru/<бот>?start=<токен>. Открывает её — MAX присылает боту bot_started с
 * этим токеном, и по нему находится учётка. Токен одноразовый и живёт 15
 * минут: ссылка, пересланная кому-то ещё, привязала бы чужой MAX к учётке.
 */
@Injectable()
export class MaxLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transport: MaxTransport,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Ссылка привязки. 503, если бота на сервере нет. */
  async issueLink(userId: string, now = new Date()): Promise<MaxLinkResponse> {
    const botLink = this.config.get('MAX_BOT_LINK', { infer: true });

    if (this.transport.mode === 'off' || (this.transport.mode === 'live' && !botLink)) {
      throw new ServiceUnavailableException('Уведомления в MAX пока не подключены');
    }

    // 24 байта — 32 символа base64url: из допустимого для start алфавита, и
    // перебирать такое нечем.
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(now.getTime() + LINK_TOKEN_TTL_MS);

    await this.prisma.$transaction([
      // Прежние неиспользованные ссылки гаснут: действует только последняя, и
      // ссылка из забытой вкладки уже ничего не привяжет.
      this.prisma.maxLinkToken.deleteMany({ where: { userId, usedAt: null } }),
      this.prisma.maxLinkToken.create({
        data: { userId, tokenHash: hashToken(token), expiresAt, createdAt: now },
      }),
    ]);

    const base = botLink ?? 'https://max.ru/yenisey_dev_bot';

    return { url: `${base}?start=${token}`, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Привязать MAX по токену из ссылки.
   *
   * Всё одной транзакцией: погасить токен, снять привязку этого MAX к другой
   * учётке, если была, и записать новую. Погашение — условным обновлением, так
   * что два одновременных запуска одной ссылки дадут одну привязку.
   */
  async consume(rawToken: string, maxUserId: bigint, now = new Date()): Promise<ConsumeResult> {
    return this.prisma.$transaction(async (tx) => {
      const tokenHash = hashToken(rawToken);
      const used = await tx.maxLinkToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });

      if (used.count === 0) {
        return { ok: false } as const;
      }

      const token = await tx.maxLinkToken.findUniqueOrThrow({
        where: { tokenHash },
        select: { user: { select: { id: true, fullName: true, deactivatedAt: true } } },
      });

      if (token.user.deactivatedAt) {
        return { ok: false } as const;
      }

      const previous = await tx.maxLink.deleteMany({
        where: { maxUserId, userId: { not: token.user.id } },
      });

      await tx.maxLink.upsert({
        where: { userId: token.user.id },
        update: { maxUserId, linkedAt: now, blockedAt: null },
        create: { userId: token.user.id, maxUserId, linkedAt: now },
      });

      return { ok: true, fullName: token.user.fullName, replaced: previous.count > 0 } as const;
    });
  }

  /** Учётка, привязанная к этому человеку в MAX, если есть. */
  findByMaxUser(maxUserId: bigint): Promise<{ userId: string; blockedAt: Date | null; fullName: string } | null> {
    return this.prisma.maxLink
      .findUnique({
        where: { maxUserId },
        select: { userId: true, blockedAt: true, user: { select: { fullName: true } } },
      })
      .then((link) => (link ? { userId: link.userId, blockedAt: link.blockedAt, fullName: link.user.fullName } : null));
  }

  /** Человек остановил бота: не слать, пока не запустит снова. */
  async markStopped(maxUserId: bigint, now = new Date()): Promise<void> {
    await this.prisma.maxLink.updateMany({ where: { maxUserId, blockedAt: null }, data: { blockedAt: now } });
  }

  /** Запустил бота снова — привязка оживает без новой ссылки. */
  async markStarted(maxUserId: bigint): Promise<void> {
    await this.prisma.maxLink.updateMany({ where: { maxUserId }, data: { blockedAt: null } });
  }

  async unlinkUser(userId: string): Promise<void> {
    await this.prisma.maxLink.deleteMany({ where: { userId } });
  }

  async unlinkMaxUser(maxUserId: bigint): Promise<boolean> {
    const removed = await this.prisma.maxLink.deleteMany({ where: { maxUserId } });

    return removed.count > 0;
  }
}
