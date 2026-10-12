import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** List-Unsubscribe и соседи — у рассылок. */
  headers?: Record<string, string>;
}

export type MailOutcome = { kind: 'sent' } | { kind: 'retry'; error: string } | { kind: 'fatal'; error: string };

export interface FakeSentEmail extends OutgoingEmail {
  at: string;
}

/**
 * Транспорт почты (решения владельца от 12.10.2026).
 *
 * Абстрактный класс, а не интерфейс: он же токен внедрения, как у MAX.
 * Настоящий — SMTP: его дают все провайдеры, поэтому провайдер выбирается
 * строкой `SMTP_URL`, а не кодом. Поддельный копит письма в памяти для
 * разработки и смоука; выключенный — production без провайдера.
 */
export abstract class MailTransport {
  abstract readonly mode: 'live' | 'fake' | 'off';

  abstract send(email: OutgoingEmail): Promise<MailOutcome>;
}

export class LiveSmtpTransport extends MailTransport {
  readonly mode = 'live' as const;
  private readonly logger = new Logger('MailTransport');
  private readonly smtp: Transporter;

  constructor(url: string) {
    super();
    this.smtp = createTransport(url);
  }

  async send(email: OutgoingEmail): Promise<MailOutcome> {
    try {
      await this.smtp.sendMail({
        from: email.from,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: email.headers,
      });

      return { kind: 'sent' };
    } catch (error) {
      const code = (error as { responseCode?: number }).responseCode;
      const message = error instanceof Error ? error.message : String(error);

      // 5xx — отказ навсегда (нет ящика, адрес запрещён); остальное — сеть и
      // временные отказы, их стоит повторить.
      if (code !== undefined && code >= 500 && code < 600) {
        return { kind: 'fatal', error: `SMTP ${code}: ${message}` };
      }

      this.logger.warn(`Письмо не ушло, повторим: ${message}`);

      return { kind: 'retry', error: message };
    }
  }
}

/** Разработка и смоук: письма в памяти, по `/api/dev/mail/sent`. */
export class FakeMailTransport extends MailTransport {
  readonly mode = 'fake' as const;
  readonly sent: FakeSentEmail[] = [];

  async send(email: OutgoingEmail): Promise<MailOutcome> {
    this.sent.push({ ...email, at: new Date().toISOString() });

    if (this.sent.length > 1000) {
      this.sent.splice(0, this.sent.length - 1000);
    }

    return { kind: 'sent' };
  }
}

export class DisabledMailTransport extends MailTransport {
  readonly mode = 'off' as const;

  async send(): Promise<MailOutcome> {
    return { kind: 'retry', error: 'Почта не настроена (SMTP_URL)' };
  }
}
