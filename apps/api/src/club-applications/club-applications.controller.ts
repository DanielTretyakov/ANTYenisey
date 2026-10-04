import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AccessTokenPayload, ClubApplicationView } from '@yenisey/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ClubApplicationDto, ClubApplicationUpdateDto } from './club-applications.dto';
import { ClubApplicationsService } from './club-applications.service';

/**
 * Форма «Подключить свой клуб» — открыта без входа. Частота — пять заявок в
 * минуту с одного адреса: человеку, поправившему опечатку, хватит с запасом,
 * а очередь сообщений владельцу не завалить. Больше держит ловушка для ботов.
 */
@Controller('club-applications')
export class ClubApplicationsController {
  constructor(private readonly applications: ClubApplicationsService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(201)
  @Post()
  async submit(@Body() dto: ClubApplicationDto): Promise<{ ok: true }> {
    await this.applications.submit(dto);

    return { ok: true };
  }
}

/** Заявки у владельца платформы — вкладка «Заявки» на «Клубах и подписках». */
@Controller('platform/club-applications')
export class PlatformClubApplicationsController {
  constructor(private readonly applications: ClubApplicationsService) {}

  @Get()
  list(@CurrentUser() user: AccessTokenPayload): Promise<ClubApplicationView[]> {
    return this.applications.list(user.sub);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: ClubApplicationUpdateDto,
  ): Promise<ClubApplicationView> {
    return this.applications.update(user.sub, id, dto);
  }
}
