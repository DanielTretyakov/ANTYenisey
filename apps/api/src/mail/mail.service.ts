import { createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@yenisey/database';
import { type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import type { LetterTemplate } from './letters';
import { normalizeEmail } from './mail-rules';
import { MailTransport } from './mail.transport';

type Db = PrismaService | Prisma.TransactionClient;

export interface MailDraft {
  to: string;
  userId?: string | null;
  template: LetterTemplate;
  payload: Prisma.InputJsonValue;
  /** Однозначно называет событие: `verify:<tokenId>`, `news:<id>`. */
  dedupeKey: string;
  sendAfter?: Date;
}

/**
 * Постановка писем в очередь (решения владельца от 12.10.2026).
 *
 * Как `NotificationsService.enqueue`: письмо пишется строкой в ТОЙ ЖЕ
 * транзакции, что событие, — откатилась заявка, нет и письма; лёг провайдер —
 * заявка всё равно проходит. Шлёт `MailDispatcher`.
 *
 * Без провайдера в production письма не ставятся вовсе: иначе очередь копила
 * бы ссылки, которые к подключению провайдера давно протухли.
 */
@Injectable()
export class MailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transport: MailTransport,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Работает ли почта — от этого зависят обещания интерфейса («письмо придёт»). */
  get enabled(): boolean {
    return this.transport.mode !== 'off';
  }

  async enqueue(db: Db, drafts: MailDraft[]): Promise<number> {
    if (!this.enabled || drafts.length === 0) {
      return 0;
    }

    const rows = drafts.map((draft) => ({ ...draft, to: normalizeEmail(draft.to) }));
    // «Не доставляется» отсекается сразу; отписка от новостей — при отправке:
    // там же проверяются согласие и подтверждение.
    const blocked = new Set(
      (
        await db.emailSuppression.findMany({
          where: { email: { in: [...new Set(rows.map((row) => row.to))] }, scope: 'ALL' },
          select: { email: true },
        })
      ).map((row) => row.email),
    );

    const { count } = await db.emailMessage.createMany({
      data: rows
        .filter((row) => !blocked.has(row.to))
        .map((row) => ({
          to: row.to,
          userId: row.userId ?? null,
          template: row.template,
          payload: row.payload,
          dedupeKey: row.dedupeKey,
          ...(row.sendAfter ? { sendAfter: row.sendAfter } : {}),
        })),
      skipDuplicates: true,
    });

    return count;
  }

  /**
   * Новости КНТ на почту — переключатель в кабинете. Включение — новое
   * согласие: снимает прежнюю отписку адреса от новостей.
   */
  async setNewsConsent(userId: string, enabled: boolean): Promise<void> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { newsEmailConsentAt: enabled ? new Date() : null },
      select: { email: true },
    });

    if (enabled) {
      await this.prisma.emailSuppression.deleteMany({ where: { email: normalizeEmail(user.email), scope: 'NEWS' } });
    }
  }

  /**
   * Отписка от новостей по ссылке из письма — по адресу: и учётка, и заявки
   * клуба с этой почтой перестают получать рассылку.
   */
  async unsubscribe(email: string): Promise<void> {
    const address = normalizeEmail(email);

    await this.prisma.$transaction([
      this.prisma.emailSuppression.upsert({
        where: { email_scope: { email: address, scope: 'NEWS' } },
        create: { email: address, scope: 'NEWS', reason: 'UNSUBSCRIBE' },
        update: {},
      }),
      this.prisma.user.updateMany({
        where: { email: { equals: address, mode: 'insensitive' } },
        data: { newsEmailConsentAt: null },
      }),
      this.prisma.clubApplication.updateMany({
        where: { email: { equals: address, mode: 'insensitive' } },
        data: { newsConsentAt: null },
      }),
    ]);
  }

  /**
   * Ключ подписи ссылок из писем (отписка). Отдельной переменной окружения
   * нет: ключ выводится из секрета refresh-токенов, а сменить его — значит
   * лишь сделать недействительными ссылки отписки в старых письмах.
   */
  linkKey(): string {
    return createHmac('sha256', this.config.get('JWT_REFRESH_SECRET', { infer: true }))
      .update('mail-links')
      .digest('base64url');
  }
}
