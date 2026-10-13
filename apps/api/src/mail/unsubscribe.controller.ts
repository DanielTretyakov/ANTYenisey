import { BadRequestException, Controller, Get, HttpCode, HttpStatus, Post, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { webOrigin, type Env } from '../config/env';
import { verifyUnsubscribe } from './mail-rules';
import { MailService } from './mail.service';

/**
 * Отписка от рассылки в одно нажатие (решения владельца от 12.10.2026,
 * 38-ФЗ) — без входа, по подписанной ссылке из письма.
 *
 * POST — кнопка «Отписаться» самого почтовика (RFC 8058,
 * `List-Unsubscribe-Post`) и страница `/unsubscribe` сайта. GET — тот же
 * адрес, открытый в браузере: ведёт на страницу сайта, а не отписывает
 * сразу — превью ссылок в почтовиках ходят по GET сами.
 */
@Public()
@Controller('mail/unsubscribe')
export class UnsubscribeController {
  constructor(
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get()
  page(@Query('t') token = '', @Res() response: Response): void {
    const origin = webOrigin({
      WEB_ORIGIN: this.config.get('WEB_ORIGIN', { infer: true }),
      CORS_ORIGINS: this.config.get('CORS_ORIGINS', { infer: true }),
    });

    response.redirect(HttpStatus.FOUND, `${origin}/unsubscribe?t=${encodeURIComponent(token)}`);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post()
  async unsubscribe(@Query('t') token = ''): Promise<{ email: string }> {
    const parsed = verifyUnsubscribe(token, this.mail.linkKey());

    if (!parsed) {
      throw new BadRequestException('Ссылка отписки повреждена — откройте её из письма целиком');
    }

    await this.mail.unsubscribe(parsed.email);

    return { email: parsed.email };
  }
}
