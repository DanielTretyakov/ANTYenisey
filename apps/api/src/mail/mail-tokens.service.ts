import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EmailTokenPurpose, Prisma } from '@yenisey/database';
import { hashToken } from '../auth/tokens';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_TOKEN_COOLDOWN_MS, EMAIL_TOKEN_TTL_MS, normalizeEmail } from './mail-rules';
import { MailService } from './mail.service';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Одноразовые ссылки из писем (решения владельца от 12.10.2026):
 * подтверждение почты и новый пароль. В базе — только SHA-256 токена, как у
 * refresh-сессий и привязки MAX: дамп таблицы не даёт войти ни за кого.
 * Сырой токен живёт в очереди писем до отправки и там же стирается.
 */
@Injectable()
export class MailTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /**
   * Письмо подтверждения почты — оно же приветствие. Без почты (production
   * без провайдера) ссылки не выдаются вовсе: по ней всё равно нечего прислать.
   */
  async sendVerification(db: Db, user: { id: string; email: string; fullName: string }, now = new Date()): Promise<boolean> {
    const raw = await this.issue(db, user.id, user.email, 'VERIFY', now);

    if (!raw) return false;

    await this.mail.enqueue(db, [
      {
        to: user.email,
        userId: user.id,
        template: 'VERIFY_EMAIL',
        payload: { name: user.fullName, token: raw.token },
        dedupeKey: `verify:${raw.id}`,
      },
    ]);

    return true;
  }

  /** Письмо со ссылкой на новый пароль. `false` — недавно уже отправляли. */
  async sendPasswordReset(db: Db, user: { id: string; email: string; fullName: string }, now = new Date()): Promise<boolean> {
    const recent = await db.emailToken.findFirst({
      where: { userId: user.id, purpose: 'RESET', createdAt: { gt: new Date(now.getTime() - EMAIL_TOKEN_COOLDOWN_MS) } },
      select: { id: true },
    });

    if (recent) return false;

    const raw = await this.issue(db, user.id, user.email, 'RESET', now);

    if (!raw) return false;

    await this.mail.enqueue(db, [
      {
        to: user.email,
        userId: user.id,
        template: 'PASSWORD_RESET',
        payload: { name: user.fullName, token: raw.token },
        dedupeKey: `reset:${raw.id}`,
      },
    ]);

    return true;
  }

  /**
   * Погасить ссылку: условным обновлением, поэтому два нажатия подряд
   * засчитают её один раз. Ссылка годна, только пока почта учётки та же, на
   * которую она ушла. `null` — ссылки нет, она истекла, использована или
   * почту сменили.
   */
  async consume(tx: Prisma.TransactionClient, token: string, purpose: EmailTokenPurpose, now = new Date()): Promise<{ userId: string } | null> {
    const tokenHash = hashToken(token);
    const row = await tx.emailToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, purpose: true, email: true, user: { select: { email: true, deactivatedAt: true, anonymizedAt: true } } },
    });

    if (!row || row.purpose !== purpose || row.user.deactivatedAt || row.user.anonymizedAt) return null;
    if (normalizeEmail(row.user.email) !== row.email) return null;

    const { count } = await tx.emailToken.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });

    if (count === 0) return null;

    // Остальные ссылки того же назначения больше не нужны.
    await tx.emailToken.updateMany({ where: { userId: row.userId, purpose, usedAt: null }, data: { usedAt: now } });

    return { userId: row.userId };
  }

  private async issue(db: Db, userId: string, email: string, purpose: EmailTokenPurpose, now: Date): Promise<{ id: string; token: string } | null> {
    if (!this.mail.enabled) return null;

    const token = randomBytes(32).toString('base64url');
    const row = await db.emailToken.create({
      data: {
        userId,
        purpose,
        email: normalizeEmail(email),
        tokenHash: hashToken(token),
        createdAt: now,
        expiresAt: new Date(now.getTime() + EMAIL_TOKEN_TTL_MS[purpose]),
      },
      select: { id: true },
    });

    return { id: row.id, token };
  }
}
