import { Body, Controller, Get, NotFoundException, Post, Query } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { FakePushTransport, PushTransport, type FakePushMessage } from './push.transport';

/**
 * Отладочные маршруты поддельных служб push — для смоука и разработки.
 *
 * Как у поддельного MAX: существуют, только пока транспорт поддельный, а
 * поддельным он бывает только вне production. Иначе — 404.
 */
@Public()
@Controller('dev/push')
export class DevPushController {
  constructor(private readonly transport: PushTransport) {}

  /** Что ушло на эту подписку, по порядку. */
  @Get('sent')
  sent(@Query('endpoint') endpoint: string): FakePushMessage[] {
    return this.fake().sent.filter((message) => message.endpoint === endpoint);
  }

  /** Подписка «отозвана браузером»: служба push ответит на неё 410. */
  @Post('gone')
  gone(@Body() body: { endpoint?: string }): { ok: true } {
    this.fake().gone.add(String(body.endpoint ?? ''));

    return { ok: true };
  }

  private fake(): FakePushTransport {
    if (!(this.transport instanceof FakePushTransport)) {
      throw new NotFoundException();
    }

    return this.transport;
  }
}
