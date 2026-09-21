import { Body, Controller, Get, Ip, Param, Patch, Post, Query } from '@nestjs/common';
import type {
  ClientSubscription,
  ClubLedgerPage,
  SubscriptionLedgerRow,
  SubscriptionPlan,
} from '@yenisey/types';
import type { ClubContext } from '../auth/club-context';
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Acting, ClientAction, type ActingClient } from '../guardianship/acting-client.guard';
import {
  AdjustSubscriptionDto,
  ClubLedgerQueryDto,
  IssueSubscriptionDto,
  SubscriptionPlanDto,
} from './dto/subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Тарифы абонементов клуба. Роли на классе: маршрут, добавленный сюда
 * завтра, окажется закрытым по умолчанию.
 *
 * Удаления тарифа нет: на проданный абонемент он ссылается с Restrict, а
 * снятый с продажи тариф просто не предлагается.
 */
@Roles('ADMIN', 'OWNER')
@Controller('clubs/:slug/subscription-plans')
export class SubscriptionPlansController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  list(@CurrentClub() club: ClubContext): Promise<SubscriptionPlan[]> {
    return this.subscriptions.listPlans(club.tenantId);
  }

  @Post()
  create(@CurrentClub() club: ClubContext, @Body() dto: SubscriptionPlanDto): Promise<SubscriptionPlan> {
    return this.subscriptions.createPlan(club.tenantId, dto);
  }

  @Patch(':id')
  update(
    @CurrentClub() club: ClubContext,
    @Param('id') id: string,
    @Body() dto: SubscriptionPlanDto,
  ): Promise<SubscriptionPlan> {
    return this.subscriptions.updatePlan(club.tenantId, id, dto);
  }
}

/**
 * История абонементов всего клуба.
 *
 * Отдельный раздел, а не приложение к карточке человека: деньги за абонементы
 * приходят мимо системы, и этот журнал — единственный след того, кто что продал
 * и кому что вернули.
 */
@Roles('ADMIN', 'OWNER')
@Controller('clubs/:slug/subscriptions')
export class ClubSubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get('ledger')
  ledger(@CurrentClub() club: ClubContext, @Query() query: ClubLedgerQueryDto): Promise<ClubLedgerPage> {
    return this.subscriptions.clubLedger(club.tenantId, query);
  }
}

/**
 * Абонементы человека — из его карточки у администратора. Сами абонементы
 * приходят вместе с карточкой; здесь продажа, корректировка и история.
 */
@Roles('ADMIN', 'OWNER')
@Controller('clubs/:slug/people/:id/subscriptions')
export class PersonSubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  /** Продать абонемент у стойки. Деньги принимаются вне системы. */
  @Post()
  issue(
    @CurrentClub() club: ClubContext,
    @Param('id') clientId: string,
    @Body() dto: IssueSubscriptionDto,
  ): Promise<ClientSubscription> {
    return this.subscriptions.issue(club.tenantId, clientId, dto.planId, { issuedBy: club.userId }, dto.hallId);
  }

  @Post(':subscriptionId/adjust')
  adjust(
    @CurrentClub() club: ClubContext,
    @Param('id') clientId: string,
    @Param('subscriptionId') subscriptionId: string,
    @Body() dto: AdjustSubscriptionDto,
    @Ip() ip: string,
  ): Promise<ClientSubscription> {
    return this.subscriptions.adjust(club.tenantId, clientId, subscriptionId, dto, {
      userId: club.userId,
      ipAddress: ip ?? null,
    });
  }

  @Get(':subscriptionId/ledger')
  ledger(
    @CurrentClub() club: ClubContext,
    @Param('id') clientId: string,
    @Param('subscriptionId') subscriptionId: string,
  ): Promise<SubscriptionLedgerRow[]> {
    return this.subscriptions.ledger(club.tenantId, clientId, subscriptionId);
  }
}

/**
 * Свои абонементы по всем клубам. Клуба в адресе нет — как у «Моих записей».
 * Родитель смотрит абонементы ребёнка тем же маршрутом с `?for=`.
 */
@Controller('me/subscriptions')
export class MeSubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @ClientAction('read')
  @Get()
  list(@Acting() acting: ActingClient): Promise<ClientSubscription[]> {
    return this.subscriptions.forClient(acting.userId);
  }
}
