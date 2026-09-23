import { timingSafeEqual } from 'node:crypto';
import { Body, Controller, Headers, HttpCode, Logger, NotFoundException, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import type { Env } from '../config/env';
import { MaxBotService } from './max-bot.service';

/**
 * Вебхук MAX: сюда бот получает события на стенде.
 *
 * Открыт (@Public), но не анонимен: MAX присылает секрет подписки в заголовке
 * X-Max-Bot-Api-Secret, и без совпадения маршрута как будто нет — 404, а не
 * 401, чтобы по ответу нельзя было понять, что он существует.
 *
 * Общий лимит частоты сюда не относится: все события приходят с адресов MAX,
 * и 120 запросов в минуту с одного адреса — это не атака, а оживлённый вечер.
 *
 * Ответ — 200 всегда, когда секрет сошёлся, даже если событие не обработалось:
 * иначе MAX повторяет его до восьми часов, а потом снимает подписку вовсе.
 * Упавшее событие видно в журнале.
 */
@Controller('max/webhook')
export class MaxWebhookController {
  private readonly logger = new Logger(MaxWebhookController.name);

  constructor(
    private readonly bot: MaxBotService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @SkipThrottle()
  @Post()
  @HttpCode(200)
  async receive(@Headers('x-max-bot-api-secret') secret: string | undefined, @Body() update: unknown): Promise<void> {
    const expected = this.config.get('MAX_WEBHOOK_SECRET', { infer: true });

    if (!expected || !secret || !sameSecret(secret, expected)) {
      throw new NotFoundException();
    }

    await this.bot.handle(update).catch((error: unknown) => {
      this.logger.error('Событие MAX не обработано', error instanceof Error ? error.stack : error);
    });
  }
}

/** Сравнение без утечки по времени: длина секрета не секрет, содержимое — да. */
function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);

  return a.length === b.length && timingSafeEqual(a, b);
}
