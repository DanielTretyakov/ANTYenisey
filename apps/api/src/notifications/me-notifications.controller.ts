import { Body, Controller, Delete, Get, HttpCode, Headers, Param, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AccessTokenPayload, MaxLinkResponse, NotificationSettingsView } from '@yenisey/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PushSubscriptionDto, PushUnsubscribeDto } from './dto/push-subscription.dto';
import { SetCategoryDto } from './dto/set-category.dto';
import { MaxLinkService } from './max-link.service';
import { NotificationsService } from './notifications.service';

/**
 * Уведомления в личном кабинете: привязка MAX, уведомления в браузере и что
 * присылать.
 *
 * Клуба в адресе нет: уведомления — свойство человека, а не членства, и
 * категории собираются по всем его клубам сразу. Ребёнок до 16 привязывает
 * свой MAX сам — это его учётка и его сообщения; записывать его родитель
 * будет по-прежнему на сайте.
 */
@Controller('me/notifications')
export class MeNotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly links: MaxLinkService,
  ) {}

  @Get()
  settings(@CurrentUser() user: AccessTokenPayload): Promise<NotificationSettingsView> {
    return this.notifications.settings(user.sub);
  }

  /** Ссылка на бота с одноразовым токеном. Часто незачем: действует последняя. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('max')
  link(@CurrentUser() user: AccessTokenPayload): Promise<MaxLinkResponse> {
    return this.links.issueLink(user.sub);
  }

  @Delete('max')
  async unlink(@CurrentUser() user: AccessTokenPayload): Promise<NotificationSettingsView> {
    await this.links.unlinkUser(user.sub);

    return this.notifications.settings(user.sub);
  }

  /** Включить уведомления в браузере на этом устройстве. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Put('push')
  subscribePush(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: PushSubscriptionDto,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<NotificationSettingsView> {
    return this.notifications.subscribe(user.sub, { endpoint: dto.endpoint, keys: dto.keys, userAgent: userAgent ?? null });
  }

  /** Выключить на этом устройстве. Адрес подписки знает только сам браузер. */
  @Post('push/unsubscribe')
  unsubscribePush(@CurrentUser() user: AccessTokenPayload, @Body() dto: PushUnsubscribeDto): Promise<NotificationSettingsView> {
    return this.notifications.unsubscribe(user.sub, dto.endpoint);
  }

  @Put('categories/:category')
  setCategory(
    @CurrentUser() user: AccessTokenPayload,
    @Param('category') category: string,
    @Body() dto: SetCategoryDto,
  ): Promise<NotificationSettingsView> {
    return this.notifications.setCategory(user.sub, category, dto.enabled);
  }

  @Post('test')
  @HttpCode(204)
  test(@CurrentUser() user: AccessTokenPayload): Promise<void> {
    return this.notifications.sendTest(user.sub);
  }
}
