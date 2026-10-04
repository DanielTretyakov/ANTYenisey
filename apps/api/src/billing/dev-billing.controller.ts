import { Body, Controller, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { BookingStatus, Role } from '@yenisey/database';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { DevBillingRunDto, DevNextChargeDto, DevProbeClubDto } from './billing.dto';
import { BillingService } from './billing.service';
import { FakePaymentProvider, PaymentProvider } from './payment-provider';

/** Постоянный пробный клуб смоука: приостановка отменяет записи — проверять её на настоящем клубе нельзя. */
const PROBE_SLUG = 'probe-billing';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Отладка подписки на КНТ — только при поддельном шлюзе, то есть вне
 * production без ключей ЮKassa (как `/api/dev/max`). Иначе 404.
 *
 * - «страница оплаты» поддельного шлюза: провести или отклонить платёж;
 * - чем кончится следующее автосписание;
 * - проход джобы с заданным «сейчас» — по одному клубу;
 * - пробный клуб смоука с одной будущей бронью.
 */
@Public()
@Controller('dev')
export class DevBillingController {
  constructor(
    private readonly provider: PaymentProvider,
    private readonly billing: BillingService,
    private readonly prisma: PrismaService,
  ) {}

  @HttpCode(200)
  @Post('payments/:id/:result')
  async decide(@Param('id') id: string, @Param('result') result: string): Promise<{ ok: true }> {
    const fake = this.fake();

    if ((result !== 'succeed' && result !== 'fail') || !fake.decide(id, result === 'succeed')) {
      throw new NotFoundException('Тестовый платёж не найден');
    }

    await this.billing.handleProviderPayment(id);

    return { ok: true };
  }

  @HttpCode(200)
  @Post('payments/next-charge')
  nextCharge(@Body() dto: DevNextChargeDto): { ok: true } {
    this.fake().nextCharge = dto.result;
    return { ok: true };
  }

  @HttpCode(200)
  @Post('billing/run')
  async run(@Body() dto: DevBillingRunDto): Promise<{ steps: Record<string, number> }> {
    this.fake();
    const tenant = dto.slug ? await this.prisma.tenant.findUnique({ where: { slug: dto.slug }, select: { id: true } }) : null;

    if (dto.slug && !tenant) throw new NotFoundException('Клуб не найден');

    return this.billing.runOnce(dto.now ? new Date(dto.now) : new Date(), tenant?.id ?? null);
  }

  /**
   * Пробный клуб «Клуб проверки подписки»: заводится один раз и каждый раз
   * сбрасывается в пробный период; руководитель — `ownerId`, у клиента
   * `clientId` — бронь через 30 дней: её отменит приостановка.
   */
  @HttpCode(200)
  @Post('billing/probe-club')
  async probeClub(@Body() dto: DevProbeClubDto): Promise<{ slug: string; bookingId: string }> {
    this.fake();
    const city = await this.prisma.city.findFirst({ where: { name: 'Красноярск' }, select: { id: true } });
    const tenant = await this.prisma.tenant.upsert({
      where: { slug: PROBE_SLUG },
      update: {},
      create: { name: 'Клуб проверки подписки', slug: PROBE_SLUG, cityId: city?.id ?? null },
      select: { id: true },
    });
    const hall = await this.prisma.hall.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: 'Зал проверки подписки' } },
      update: {},
      create: {
        tenantId: tenant.id,
        name: 'Зал проверки подписки',
        timezone: 'Asia/Krasnoyarsk',
        cityId: city?.id ?? null,
        address: 'Красноярск, ул. Проверочная, 1',
        addressFiasId: 'seed-probe-billing',
        tableHourPrice: 40_000,
        tableExtra30MinPrice: 20_000,
      },
      select: { id: true },
    });
    const table = await this.prisma.table.upsert({
      where: { hallId_label: { hallId: hall.id, label: 'Стол 1' } },
      update: {},
      create: { tenantId: tenant.id, hallId: hall.id, label: 'Стол 1' },
      select: { id: true },
    });

    await this.prisma.tenantMembership.upsert({
      where: { userId_tenantId: { userId: dto.ownerId, tenantId: tenant.id } },
      update: { roles: [Role.OWNER], deactivatedAt: null },
      create: { userId: dto.ownerId, tenantId: tenant.id, roles: [Role.OWNER] },
    });
    await this.prisma.tenantMembership.upsert({
      where: { userId_tenantId: { userId: dto.clientId, tenantId: tenant.id } },
      update: {},
      create: { userId: dto.clientId, tenantId: tenant.id, roles: [Role.CLIENT] },
    });
    await this.prisma.clientProfile.upsert({
      where: { userId_tenantId: { userId: dto.clientId, tenantId: tenant.id } },
      update: {},
      create: { userId: dto.clientId, tenantId: tenant.id },
    });

    // Каждый прогон — с чистого пробного периода и без реквизитов.
    await this.prisma.clubRequisites.deleteMany({ where: { tenantId: tenant.id } });
    await this.billing.ensure(tenant.id);
    await this.prisma.tenantSubscription.update({
      where: { tenantId: tenant.id },
      data: {
        status: 'TRIAL',
        trialEndsAt: new Date(Date.now() + 7 * DAY_MS),
        planId: null,
        priceAtPurchase: null,
        paidUntil: null,
        pastDueSince: null,
        suspendedAt: null,
        chargeAttempts: 0,
        lastChargeAttemptAt: null,
        savedPaymentMethodId: null,
        paymentMethodTitle: null,
        nextChargeDate: null,
        autoRenew: true,
      },
    });

    const startsAt = new Date(Date.now() + 30 * DAY_MS);
    startsAt.setUTCMinutes(0, 0, 0);
    const booking = await this.prisma.tableBooking.create({
      data: {
        tenantId: tenant.id,
        tableId: table.id,
        clientId: dto.clientId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
        priceAtBooking: 40_000,
        status: BookingStatus.BOOKED,
      },
      select: { id: true },
    });

    return { slug: PROBE_SLUG, bookingId: booking.id };
  }

  private fake(): FakePaymentProvider {
    if (!(this.provider instanceof FakePaymentProvider)) {
      throw new NotFoundException();
    }

    return this.provider;
  }
}
