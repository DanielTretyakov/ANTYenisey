import { Controller, Get, Header, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../auth/decorators/public.decorator';
import { webOrigin, type Env } from '../config/env';
import { escapeHtml, renderLetter } from './letters';
import { LETTER_SAMPLES as SAMPLES } from './letter-samples';
import { normalizeEmail } from './mail-rules';
import { MailDispatcher } from './mail-dispatcher.job';
import { FakeMailTransport, MailTransport, type FakeSentEmail } from './mail.transport';

/**
 * Отладочные маршруты поддельной почты — для смоука и просмотра вёрстки.
 * Существуют, только пока транспорт поддельный (вне production без
 * `SMTP_URL`), иначе — 404, как `dev-max`.
 */
@Public()
@Controller('dev/mail')
export class DevMailController {
  constructor(
    private readonly transport: MailTransport,
    private readonly dispatcher: MailDispatcher,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Что ушло на этот адрес, по порядку. */
  @Get('sent')
  sent(@Query('to') to = ''): FakeSentEmail[] {
    const address = normalizeEmail(to);

    return this.fake().sent.filter((email) => email.to === address);
  }

  /** Отправить очередь сейчас, не дожидаясь прохода. */
  @Post('dispatch')
  dispatch(): Promise<{ claimed: number; sent: number }> {
    this.fake();

    return this.dispatcher.runOnce();
  }

  /** Все письма на пробных данных — для владельца и для глаз. */
  @Get('preview')
  @Header('Content-Type', 'text/html; charset=utf-8')
  previewIndex(): string {
    this.fake();

    const links = SAMPLES.map(
      (sample) => `<li><a href="preview/${sample.id}">${escapeHtml(sample.title)}</a> <small>${sample.template}</small></li>`,
    ).join('');

    return `<!doctype html><meta charset="utf-8"><title>Письма КНТ</title><body style="font:16px/1.6 system-ui;padding:32px;max-width:640px;margin:auto"><h1>Письма КНТ</h1><p>Пробные данные; тёмная тема — по теме системы.</p><ul>${links}</ul></body>`;
  }

  @Get('preview/:id')
  @Header('Content-Type', 'text/html; charset=utf-8')
  preview(@Param('id') id: string): string {
    this.fake();

    const sample = SAMPLES.find((item) => item.id === id);

    if (!sample) throw new NotFoundException();

    const origin = webOrigin({
      WEB_ORIGIN: this.config.get('WEB_ORIGIN', { infer: true }),
      CORS_ORIGINS: this.config.get('CORS_ORIGINS', { infer: true }),
    });

    return renderLetter(sample.template, sample.payload, {
      webOrigin: origin,
      operator: null,
      ...(sample.news ? { unsubscribeUrl: `${origin}/unsubscribe?t=proba` } : {}),
    }).html;
  }

  private fake(): FakeMailTransport {
    if (!(this.transport instanceof FakeMailTransport)) {
      throw new NotFoundException();
    }

    return this.transport;
  }
}
