import { BadRequestException, Body, Controller, Get, NotFoundException, Post, Query } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { NotificationDispatcher } from './dispatcher.job';
import { MaxBotService } from './max-bot.service';
import { NotificationScheduler } from './scheduler.job';
import { FakeMaxTransport, MaxTransport, type FakeSentMessage } from './max.transport';

/**
 * Отладочные маршруты поддельного MAX — для смоука и разработки без бота.
 *
 * Существуют, только пока транспорт поддельный, а поддельным он бывает только
 * вне production (notifications.module.ts). Во всех остальных случаях — 404,
 * как если бы маршрутов не было вовсе.
 *
 * Смоук через них делает то, что в жизни делает MAX: присылает боту событие
 * «человек открыл ссылку» и смотрит, что бот ему ответил.
 */
@Public()
@Controller('dev/max')
export class DevMaxController {
  constructor(
    private readonly transport: MaxTransport,
    private readonly bot: MaxBotService,
    private readonly dispatcher: NotificationDispatcher,
    private readonly scheduler: NotificationScheduler,
  ) {}

  /** Событие MAX как есть: bot_started, bot_stopped, message_created. */
  @Post('events')
  async event(@Body() update: unknown): Promise<{ ok: true }> {
    this.fake();
    await this.bot.handle(update);

    return { ok: true };
  }

  /** Что ушло этому человеку в MAX, по порядку. */
  @Get('sent')
  sent(@Query('maxUserId') maxUserId: string): FakeSentMessage[] {
    return this.fake().sent.filter((message) => message.maxUserId === maxUserId);
  }

  /** Человек «остановил бота» так, что MAX об этом не сообщил: отправка получит 403. */
  @Post('stopped')
  stop(@Body() body: { maxUserId?: string }): { ok: true } {
    this.fake().stopped.add(String(body.maxUserId ?? ''));

    return { ok: true };
  }

  /** Один проход отправщика — не дожидаясь интервала. */
  @Post('dispatch')
  dispatch(): Promise<{ claimed: number; sent: number }> {
    this.fake();

    return this.dispatcher.runOnce();
  }

  /**
   * Один проход планировщика с подставным «сейчас»: напоминание за три часа
   * до начала смоук проверяет, не дожидаясь трёх часов.
   */
  @Post('schedule')
  schedule(@Body() body: { now?: string }): Promise<{ reminders: number; subscriptions: number }> {
    this.fake();
    const now = body.now ? new Date(body.now) : new Date();

    if (Number.isNaN(now.getTime())) {
      throw new BadRequestException('now — момент ISO-8601');
    }

    return this.scheduler.runOnce(now);
  }

  private fake(): FakeMaxTransport {
    if (!(this.transport instanceof FakeMaxTransport)) {
      throw new NotFoundException();
    }

    return this.transport;
  }
}
