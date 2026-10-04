import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseEnumPipe, Post, Put } from '@nestjs/common';
import type { AccessTokenPayload, BillingView, CardPaymentStart, PlatformClubRow, PlatformDocument, PlatformPlanView } from '@yenisey/types';
import type { ClubContext } from '../auth/club-context';
import { CurrentClub } from '../auth/decorators/current-club.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AutoRenewDto, ExemptDto, ExtendDto, PlanChoiceDto, RequisitesDto } from './billing.dto';
import { BillingService } from './billing.service';
import { OpenWhenSuspended } from './open-when-suspended.decorator';

/**
 * «Подписка на КНТ» — только руководителю клуба (решение владельца от
 * 02.10.2026): деньги клуба платформе — дело договора, не смены. Открыта и
 * при приостановленном доступе: иначе заплатить было бы нечем.
 */
@Roles('OWNER')
@OpenWhenSuspended()
@Controller('clubs/:slug/billing')
export class ClubBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  view(@CurrentClub() club: ClubContext): Promise<BillingView> {
    return this.billing.view(club.tenantId);
  }

  @Put('requisites')
  requisites(@CurrentClub() club: ClubContext, @Body() dto: RequisitesDto): Promise<BillingView> {
    return this.billing.setRequisites(club.tenantId, { ...dto, kpp: dto.kpp ?? null });
  }

  @Put('auto-renew')
  autoRenew(@CurrentClub() club: ClubContext, @Body() dto: AutoRenewDto): Promise<BillingView> {
    return this.billing.setAutoRenew(club.tenantId, dto.autoRenew);
  }

  /** Оплата картой: в ответе — страница шлюза, куда уходит руководитель. */
  @Post('card')
  card(@CurrentClub() club: ClubContext, @Body() dto: PlanChoiceDto): Promise<CardPaymentStart> {
    return this.billing.startCard(club.tenantId, dto.planId);
  }

  /** Вернулись со страницы оплаты — спросить шлюз, прошла ли. */
  @HttpCode(200)
  @Post('card/:paymentId/sync')
  sync(@CurrentClub() club: ClubContext, @Param('paymentId') paymentId: string): Promise<BillingView> {
    return this.billing.syncCard(club.tenantId, paymentId);
  }

  @Post('invoice')
  invoice(@CurrentClub() club: ClubContext, @Body() dto: PlanChoiceDto): Promise<BillingView> {
    return this.billing.issueInvoice(club.tenantId, dto.planId);
  }

  @Get('documents/:kind/:id')
  document(
    @CurrentClub() club: ClubContext,
    @Param('kind', new ParseEnumPipe(['INVOICE', 'ACT'])) kind: 'INVOICE' | 'ACT',
    @Param('id') id: string,
  ): Promise<PlatformDocument> {
    return this.billing.document(club.tenantId, kind, id);
  }
}

/**
 * «Клубы и подписки» владельца платформы — минимальная роль администратора
 * платформы из ТЗ. Клуба в адресе нет, поэтому владельца проверяет не
 * `@Roles` (роли клубные), а сам контроллер — как у новостей платформы.
 */
@Controller('platform/clubs')
export class PlatformClubsController {
  constructor(
    private readonly billing: BillingService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AccessTokenPayload): Promise<PlatformClubRow[]> {
    await this.assertOwner(user.sub);
    return this.billing.listClubs();
  }

  @HttpCode(200)
  @Post('invoices/:paymentId/paid')
  async paid(@CurrentUser() user: AccessTokenPayload, @Param('paymentId') paymentId: string): Promise<PlatformClubRow[]> {
    await this.assertOwner(user.sub);
    return this.billing.markInvoicePaid(paymentId);
  }

  @Put(':club/exempt')
  async exempt(@CurrentUser() user: AccessTokenPayload, @Param('club') slug: string, @Body() dto: ExemptDto): Promise<PlatformClubRow[]> {
    await this.assertOwner(user.sub);
    return this.billing.setExempt(slug, dto.exempt);
  }

  @HttpCode(200)
  @Post(':club/extend')
  async extend(@CurrentUser() user: AccessTokenPayload, @Param('club') slug: string, @Body() dto: ExtendDto): Promise<PlatformClubRow[]> {
    await this.assertOwner(user.sub);
    return this.billing.extend(slug, dto.days);
  }

  private async assertOwner(userId: string): Promise<void> {
    const found = await this.prisma.user.findUnique({ where: { id: userId }, select: { platformRole: true, deactivatedAt: true } });

    if (found?.platformRole !== 'OWNER' || found.deactivatedAt) {
      throw new ForbiddenException('Подписки клубов ведёт только владелец платформы');
    }
  }
}

/**
 * Тарифы КНТ — открыто: их показывает страница «Подключить свой клуб» тому,
 * у кого клуба на платформе ещё нет (решение от 03.10.2026). Те же строки и
 * тот же расчёт выгоды, что на странице подписки клуба, — второй прайс «для
 * витрины» разошёлся бы с настоящим.
 */
@Controller('platform/plans')
export class PlatformPlansController {
  constructor(private readonly billing: BillingService) {}

  @Public()
  @Get()
  plans(): Promise<PlatformPlanView[]> {
    return this.billing.plans();
  }
}

/**
 * Уведомления ЮKassa о платежах. Открыт, но телу не верим: по id платёж
 * перечитывается у самой ЮKassa, и подделанное событие ничего не проведёт.
 * Отвечаем 200 на всё — иначе ЮKassa повторяет событие сутки.
 */
@Controller('yookassa')
export class YooKassaWebhookController {
  constructor(private readonly billing: BillingService) {}

  @Public()
  @HttpCode(200)
  @Post('webhook')
  async webhook(@Body() body: { object?: { id?: unknown } }): Promise<{ ok: true }> {
    const id = body?.object?.id;

    if (typeof id === 'string' && id.length > 0 && id.length < 100) {
      await this.billing.handleProviderPayment(id).catch(() => undefined);
    }

    return { ok: true };
  }
}
