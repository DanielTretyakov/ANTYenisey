import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type EmailStatus } from '@yenisey/database';
import { parseDuration } from '../auth/tokens';
import { mailJobEnabled, webOrigin, type Env } from '../config/env';
import { afterFailure } from '../notifications/notification-rules';
import { PrismaService } from '../prisma/prisma.service';
import { LETTER_AUDIENCE, renderLetter, SECRET_FIELDS, type LetterTemplate } from './letters';
import { sendProblem, signUnsubscribe } from './mail-rules';
import { MailService } from './mail.service';
import { MailTransport } from './mail.transport';

const BATCH = 25;
const LEASE_MS = 2 * 60_000;
const FIRST_RUN_DELAY = 5_000;

interface ClaimedRow {
  id: string;
  to: string;
  userId: string | null;
  template: string;
  payload: Prisma.JsonValue;
  attempts: number;
  createdAt: Date;
}

/**
 * Отправщик почты — те же приёмы, что `NotificationDispatcher`: аренда пачки
 * `FOR UPDATE SKIP LOCKED` со сдвигом срока, повтор по `afterFailure`, проход
 * `runOnce()` открыт смоуку.
 *
 * Перед отправкой каждое письмо сверяется с адресатом (`sendProblem`): между
 * постановкой и отправкой человек мог отписаться, сменить почту или снять
 * согласие. Ссылки-ключи (`token`) после отправки стираются из очереди.
 */
@Injectable()
export class MailDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MailDispatcher.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;
  private stopped = false;
  private lastSend = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transport: MailTransport,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    const enabled = mailJobEnabled({
      MAIL_JOB: this.config.get('MAIL_JOB', { infer: true }),
      NODE_ENV: this.config.get('NODE_ENV', { infer: true }),
    });

    if (!enabled || this.transport.mode === 'off') {
      this.logger.log(enabled ? 'Отправка почты выключена: не задан SMTP_URL' : 'Отправка почты выключена (MAIL_JOB)');
      return;
    }

    this.logger.log(`Отправка почты включена: ${this.transport.mode}`);
    this.schedule(FIRST_RUN_DELAY);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;

    if (this.timer) clearTimeout(this.timer);

    await this.running;
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      let full = false;

      this.running = this.runOnce()
        .then((result) => {
          full = result.claimed === BATCH;
        })
        .catch((error: unknown) => {
          this.logger.error('Проход отправки почты упал', error instanceof Error ? error.stack : error);
        })
        .finally(() => {
          this.running = null;

          if (!this.stopped) {
            this.schedule(full ? 0 : parseDuration(this.config.get('MAIL_JOB_INTERVAL', { infer: true })));
          }
        });
    }, delay);

    this.timer.unref();
  }

  async runOnce(now: Date = new Date()): Promise<{ claimed: number; sent: number }> {
    const rows = await this.claim(now);
    let sent = 0;

    for (const row of rows) {
      if (await this.deliver(row)) sent += 1;
    }

    return { claimed: rows.length, sent };
  }

  private async deliver(row: ClaimedRow): Promise<boolean> {
    const template = row.template as LetterTemplate;
    const audience = LETTER_AUDIENCE[template];

    if (!audience) {
      await this.finish(row.id, 'FAILED', `неизвестный шаблон ${row.template}`);
      return false;
    }

    const [user, suppressions] = await Promise.all([
      row.userId
        ? this.prisma.user.findUnique({
            where: { id: row.userId },
            select: { email: true, emailVerifiedAt: true, newsEmailConsentAt: true, deactivatedAt: true },
          })
        : null,
      this.prisma.emailSuppression.findMany({ where: { email: row.to }, select: { scope: true } }),
    ]);

    const problem = sendProblem(audience, row.to, {
      user,
      suppressed: suppressions.map((item) => item.scope),
    });

    if (problem) {
      await this.finish(row.id, 'SKIPPED', problem);
      return false;
    }

    const origin = webOrigin({
      WEB_ORIGIN: this.config.get('WEB_ORIGIN', { infer: true }),
      CORS_ORIGINS: this.config.get('CORS_ORIGINS', { infer: true }),
    });
    const unsubscribe = audience === 'news' ? signUnsubscribe(row.to, 'NEWS', this.mail.linkKey()) : null;
    const letter = renderLetter(template, row.payload, {
      webOrigin: origin,
      operator: this.operator(),
      ...(unsubscribe ? { unsubscribeUrl: `${origin}/unsubscribe?t=${unsubscribe}` } : {}),
    });

    await this.pace();

    const outcome = await this.transport.send({
      from: this.config.get('MAIL_FROM', { infer: true }),
      to: row.to,
      subject: letter.subject,
      html: letter.html,
      text: letter.text,
      ...(unsubscribe
        ? {
            headers: {
              // Кнопка «Отписаться» самого почтовика (RFC 8058): одно нажатие,
              // без входа и без нашей страницы.
              'List-Unsubscribe': `<${origin}/api/mail/unsubscribe?t=${unsubscribe}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          }
        : {}),
    });

    if (outcome.kind === 'sent') {
      await this.prisma.emailMessage.update({
        where: { id: row.id },
        data: { status: 'SENT', sentAt: new Date(), error: null, payload: scrub(row.payload) },
      });
      return true;
    }

    if (outcome.kind === 'fatal') {
      await this.finish(row.id, 'FAILED', outcome.error);
      return false;
    }

    const next = afterFailure(row.attempts, new Date());

    await this.prisma.emailMessage.update({
      where: { id: row.id },
      data: next.status === 'FAILED' ? { status: 'FAILED', error: outcome.error.slice(0, 1000) } : { sendAfter: next.sendAfter, error: outcome.error.slice(0, 1000) },
    });

    return false;
  }

  /** Лимит провайдера: не чаще `MAIL_RATE_PER_MINUTE` писем в минуту. */
  private async pace(): Promise<void> {
    const gap = 60_000 / this.config.get('MAIL_RATE_PER_MINUTE', { infer: true });
    const wait = this.lastSend + gap - Date.now();

    if (wait > 0 && this.transport.mode === 'live') {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }

    this.lastSend = Date.now();
  }

  /** Оператор для подвала — те же реквизиты, что у счетов. */
  private operator(): string | null {
    const name = this.config.get('BILLING_SELLER_NAME', { infer: true });
    const inn = this.config.get('BILLING_SELLER_INN', { infer: true });

    return name ? `${name}${inn ? `, ИНН ${inn}` : ''}` : null;
  }

  private async claim(now: Date): Promise<ClaimedRow[]> {
    const lease = new Date(now.getTime() + LEASE_MS);

    const rows = await this.prisma.$queryRaw<ClaimedRow[]>(Prisma.sql`
      UPDATE "EmailMessage"
      SET "sendAfter" = ${lease}, "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id" FROM "EmailMessage"
        WHERE "status" = 'PENDING' AND "sendAfter" <= ${now}
        ORDER BY "sendAfter", "createdAt"
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "to", "userId", "template", "payload", "attempts", "createdAt"
    `);

    return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  }

  private async finish(id: string, status: EmailStatus, error: string): Promise<void> {
    await this.prisma.emailMessage.update({ where: { id }, data: { status, error: error.slice(0, 1000) } });
  }
}

/** Стереть ключи ссылок: после отправки хранить их в очереди незачем. */
function scrub(payload: Prisma.JsonValue): Prisma.InputJsonValue {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return (payload ?? {}) as Prisma.InputJsonValue;
  }

  const copy = { ...payload } as Record<string, Prisma.JsonValue>;

  for (const field of SECRET_FIELDS) {
    if (field in copy) copy[field] = '•';
  }

  return copy as Prisma.InputJsonValue;
}
