import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ActorType,
  AuditAction,
  BookingStatus,
  Prisma,
  type NotificationType,
  type PlatformPaymentStatus,
} from '@yenisey/database';
import {
  planEconomics,
  type BillingView,
  type CardPaymentStart,
  type ClubRequisitesView,
  type PlatformClubRow,
  type PlatformDocument,
  type PlatformPaymentView,
  type PlatformPlanView,
  type PlatformSeller,
  type PlatformStatus,
} from '@yenisey/types';
import { webOrigin, type Env } from '../config/env';
import { ClientNotifier } from '../notifications/client-notifier.service';
import { clubTimezone } from '../notifications/clock';
import type { PlatformBillingPayload } from '../notifications/render';
import { StaffNotifier } from '../notifications/staff-notifier.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { billingStep, graceUntil, monthlyActs, paidPeriod, TRIAL_DAYS, type BillingStep } from './billing-rules';
import { PaymentProvider, type ProviderPayment } from './payment-provider';

const DAY_MS = 24 * 60 * 60 * 1000;

type Tx = Prisma.TransactionClient;

const SUBSCRIPTION_SELECT = {
  id: true,
  tenantId: true,
  status: true,
  planId: true,
  priceAtPurchase: true,
  trialEndsAt: true,
  paidUntil: true,
  autoRenew: true,
  savedPaymentMethodId: true,
  paymentMethodTitle: true,
  pastDueSince: true,
  chargeAttempts: true,
  lastChargeAttemptAt: true,
  suspendedAt: true,
  plan: { select: { name: true, periodMonths: true, price: true } },
  tenant: { select: { name: true, slug: true } },
} as const;

type SubscriptionRow = Prisma.TenantSubscriptionGetPayload<{ select: typeof SUBSCRIPTION_SELECT }>;

const PAYMENT_SELECT = {
  id: true,
  createdAt: true,
  method: true,
  status: true,
  amount: true,
  autoCharge: true,
  invoiceNumber: true,
  periodFrom: true,
  periodTo: true,
  paidAt: true,
  failureReason: true,
  plan: { select: { name: true } },
  acts: {
    select: { id: true, number: true, periodFrom: true, periodTo: true, amount: true },
    orderBy: { number: 'asc' },
  },
} as const;

/**
 * Подписка клуба на КНТ — деньги «клуб → платформа» (ТЗ → «Монетизация
 * платформы», решения владельца от 02.10.2026).
 *
 * Правила переходов — чистые функции `billing-rules.ts`; здесь — их
 * исполнение: платежи, акты, сообщения руководителю и приостановка, которая
 * отменяет все будущие записи клуба с полным возвратом.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: PaymentProvider,
    private readonly staff: StaffNotifier,
    private readonly clients: ClientNotifier,
    private readonly subscriptions: SubscriptionsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // --- Страница руководителя ------------------------------------------------

  async view(tenantId: string): Promise<BillingView> {
    const sub = await this.ensure(tenantId);
    const [plans, payments, requisites] = await Promise.all([
      this.plans(),
      this.prisma.platformPayment.findMany({
        where: { tenantId },
        select: PAYMENT_SELECT,
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.clubRequisites.findUnique({ where: { tenantId } }),
    ]);
    const charges = sub.autoRenew && sub.savedPaymentMethodId !== null && sub.status === 'ACTIVE' && sub.paidUntil;

    return {
      status: sub.status as PlatformStatus,
      planName: sub.plan?.name ?? null,
      trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
      paidUntil: sub.paidUntil?.toISOString() ?? null,
      graceUntil: sub.status === 'PAST_DUE' && sub.pastDueSince ? graceUntil(sub.pastDueSince).toISOString() : null,
      suspendedAt: sub.suspendedAt?.toISOString() ?? null,
      autoRenew: sub.autoRenew,
      paymentMethodTitle: sub.paymentMethodTitle,
      nextCharge: charges && sub.priceAtPurchase !== null ? { at: sub.paidUntil!.toISOString(), amount: sub.priceAtPurchase } : null,
      plans,
      payments: payments.map(toPaymentView),
      requisites: requisites ? toRequisites(requisites) : null,
      cardAvailable: this.provider.available,
    };
  }

  async plans(): Promise<PlatformPlanView[]> {
    const rows = await this.prisma.platformPlan.findMany({
      where: { isActive: true },
      select: { id: true, name: true, periodMonths: true, price: true },
      orderBy: { periodMonths: 'asc' },
    });
    const month = rows.find((row) => row.periodMonths === 1)?.price ?? null;

    return rows.map((row) => ({ ...row, ...planEconomics(row, month) }));
  }

  async setRequisites(tenantId: string, input: ClubRequisitesView): Promise<BillingView> {
    const data = {
      legalName: input.legalName.trim(),
      inn: input.inn.trim(),
      kpp: input.kpp?.trim() || null,
      address: input.address.trim(),
      email: input.email.trim(),
    };

    await this.prisma.clubRequisites.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });

    return this.view(tenantId);
  }

  async setAutoRenew(tenantId: string, autoRenew: boolean): Promise<BillingView> {
    await this.ensure(tenantId);
    await this.prisma.tenantSubscription.update({ where: { tenantId }, data: { autoRenew } });

    return this.view(tenantId);
  }

  /** Оплата картой: платёж ждёт подтверждения на странице шлюза. */
  async startCard(tenantId: string, planId: string): Promise<CardPaymentStart> {
    const sub = await this.ensure(tenantId);
    this.refuseExempt(sub);
    const plan = await this.activePlan(planId);

    const payment = await this.prisma.platformPayment.create({
      data: { tenantId, planId: plan.id, amount: plan.price, method: 'CARD' },
      select: { id: true },
    });
    const origin = webOrigin({
      WEB_ORIGIN: this.config.get('WEB_ORIGIN', { infer: true }),
      CORS_ORIGINS: this.config.get('CORS_ORIGINS', { infer: true }),
    });

    const remote = await this.provider.create({
      amount: plan.price,
      description: `КНТ: доступ клуба «${sub.tenant.name}», тариф «${plan.name}»`,
      returnUrl: `${origin}/clubs/${sub.tenant.slug}/billing?payment=${payment.id}`,
      idempotenceKey: payment.id,
      metadata: { platformPaymentId: payment.id, tenantId },
    });

    await this.prisma.platformPayment.update({ where: { id: payment.id }, data: { providerPaymentId: remote.id } });

    if (!remote.confirmationUrl) {
      throw new ConflictException('Платёжный сервис не дал страницу оплаты — попробуйте ещё раз');
    }

    return { paymentId: payment.id, confirmationUrl: remote.confirmationUrl };
  }

  /**
   * Вернулись со страницы оплаты: спросить шлюз и провести. Вебхук сделает то
   * же самое — кто первый, тот и проводит, второй увидит уже не PENDING.
   */
  async syncCard(tenantId: string, paymentId: string): Promise<BillingView> {
    const payment = await this.prisma.platformPayment.findFirst({
      where: { id: paymentId, tenantId, method: 'CARD' },
      select: { providerPaymentId: true, status: true },
    });

    if (!payment) {
      throw new NotFoundException('Платёж не найден');
    }

    if (payment.status === 'PENDING' && payment.providerPaymentId) {
      await this.applyProviderPayment(await this.provider.get(payment.providerPaymentId));
    }

    return this.view(tenantId);
  }

  /** Событие шлюза (вебхук или поддельная страница): вебхуку на слово не верим — перечитываем. */
  async handleProviderPayment(providerPaymentId: string): Promise<void> {
    await this.applyProviderPayment(await this.provider.get(providerPaymentId));
  }

  /** Счёт для юрлица: нужны реквизиты; прежний неоплаченный счёт отменяется. */
  async issueInvoice(tenantId: string, planId: string): Promise<BillingView> {
    const sub = await this.ensure(tenantId);
    this.refuseExempt(sub);
    const plan = await this.activePlan(planId);
    const requisites = await this.prisma.clubRequisites.findUnique({ where: { tenantId }, select: { tenantId: true } });

    if (!requisites) {
      throw new BadRequestException('Для счёта нужны реквизиты клуба — заполните их ниже');
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.platformPayment.updateMany({
            where: { tenantId, method: 'INVOICE', status: 'PENDING' },
            data: { status: 'CANCELLED', failureReason: 'Заменён новым счётом' },
          });
          const last = await tx.platformPayment.aggregate({ _max: { invoiceNumber: true } });

          await tx.platformPayment.create({
            data: {
              tenantId,
              planId: plan.id,
              amount: plan.price,
              method: 'INVOICE',
              invoiceNumber: (last._max.invoiceNumber ?? 0) + 1,
            },
          });
        });

        return this.view(tenantId);
      } catch (error) {
        // Номер счёта сквозной: два счёта одновременно — второй берёт следующий.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      }
    }

    throw new ConflictException('Не удалось выставить счёт — попробуйте ещё раз');
  }

  /** Счёт или акт для печати. Только своего клуба. */
  async document(tenantId: string, kind: 'INVOICE' | 'ACT', id: string): Promise<PlatformDocument> {
    const requisites = await this.prisma.clubRequisites.findUnique({ where: { tenantId } });
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });

    if (!requisites) {
      throw new BadRequestException('Реквизиты клуба не заполнены');
    }

    const buyer = { ...toRequisites(requisites), club: tenant.name };
    const seller = this.seller();

    if (kind === 'INVOICE') {
      const payment = await this.prisma.platformPayment.findFirst({
        where: { id, tenantId, method: 'INVOICE' },
        select: { invoiceNumber: true, createdAt: true, amount: true, plan: { select: { name: true } } },
      });

      if (!payment || payment.invoiceNumber === null) throw new NotFoundException('Счёт не найден');

      return {
        kind,
        number: payment.invoiceNumber,
        date: payment.createdAt.toISOString(),
        amount: payment.amount,
        subject: `Доступ к платформе КНТ для клуба «${tenant.name}», тариф «${payment.plan.name}»`,
        buyer,
        seller,
      };
    }

    const act = await this.prisma.platformAct.findFirst({
      where: { id, tenantId },
      select: { number: true, periodFrom: true, periodTo: true, amount: true, payment: { select: { plan: { select: { name: true } } } } },
    });

    if (!act) throw new NotFoundException('Акт не найден');

    return {
      kind,
      number: act.number,
      date: act.periodTo.toISOString(),
      amount: act.amount,
      subject: `Доступ к платформе КНТ для клуба «${tenant.name}», тариф «${act.payment.plan.name}», ${period(act.periodFrom, act.periodTo)}`,
      buyer,
      seller,
    };
  }

  // --- Владелец платформы ---------------------------------------------------

  async listClubs(): Promise<PlatformClubRow[]> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true }, orderBy: { name: 'asc' } });
    await Promise.all(tenants.map((tenant) => this.ensure(tenant.id)));

    const rows = await this.prisma.tenantSubscription.findMany({
      select: {
        ...SUBSCRIPTION_SELECT,
        tenant: {
          select: {
            name: true,
            slug: true,
            platformPayments: {
              where: { method: 'INVOICE', status: 'PENDING' },
              select: { id: true, invoiceNumber: true, amount: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
      orderBy: { tenant: { name: 'asc' } },
    });

    return rows.map((row) => {
      const invoice = row.tenant.platformPayments[0];

      return {
        slug: row.tenant.slug,
        name: row.tenant.name,
        status: row.status as PlatformStatus,
        planName: row.plan?.name ?? null,
        trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
        paidUntil: row.paidUntil?.toISOString() ?? null,
        graceUntil: row.status === 'PAST_DUE' && row.pastDueSince ? graceUntil(row.pastDueSince).toISOString() : null,
        paymentMethodTitle: row.paymentMethodTitle,
        pendingInvoice:
          invoice && invoice.invoiceNumber !== null
            ? { paymentId: invoice.id, number: invoice.invoiceNumber, amount: invoice.amount }
            : null,
      };
    });
  }

  /** Деньги по счёту пришли — владелец платформы отмечает, доступ продлевается. */
  async markInvoicePaid(paymentId: string, now = new Date()): Promise<PlatformClubRow[]> {
    const payment = await this.prisma.platformPayment.findUnique({
      where: { id: paymentId },
      select: { method: true, status: true },
    });

    if (!payment || payment.method !== 'INVOICE') throw new NotFoundException('Счёт не найден');
    if (payment.status !== 'PENDING') throw new ConflictException('Счёт уже проведён или отменён');

    await this.settle(paymentId, now, null);

    return this.listClubs();
  }

  /** «Без оплаты» — пилотный клуб; снятие возвращает в пробный период. */
  async setExempt(slug: string, exempt: boolean, now = new Date()): Promise<PlatformClubRow[]> {
    const tenantId = await this.tenantIdOf(slug);
    const sub = await this.ensure(tenantId);

    if (exempt) {
      await this.prisma.tenantSubscription.update({
        where: { tenantId },
        data: { status: 'EXEMPT', pastDueSince: null, suspendedAt: null, chargeAttempts: 0 },
      });
    } else if (sub.status === 'EXEMPT') {
      await this.prisma.tenantSubscription.update({
        where: { tenantId },
        data: sub.planId && sub.paidUntil && sub.paidUntil > now
          ? { status: 'ACTIVE' }
          : { status: 'TRIAL', trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS) },
      });
    }

    return this.listClubs();
  }

  /**
   * Продлить вручную на `days` дней — договорились с клубом, деньги придут
   * позже. Клуб без тарифа получает продлённый пробный период.
   */
  async extend(slug: string, days: number, now = new Date()): Promise<PlatformClubRow[]> {
    const tenantId = await this.tenantIdOf(slug);
    const sub = await this.ensure(tenantId);
    const add = days * DAY_MS;

    if (sub.status === 'EXEMPT') throw new ConflictException('Клуб и так без оплаты');

    if (sub.planId === null) {
      const base = sub.status === 'TRIAL' && sub.trialEndsAt && sub.trialEndsAt > now ? sub.trialEndsAt : now;
      await this.prisma.tenantSubscription.update({
        where: { tenantId },
        data: { status: 'TRIAL', trialEndsAt: new Date(base.getTime() + add), pastDueSince: null, suspendedAt: null, chargeAttempts: 0 },
      });
    } else {
      const base = sub.paidUntil && sub.paidUntil > now ? sub.paidUntil : now;
      await this.prisma.tenantSubscription.update({
        where: { tenantId },
        data: { status: 'ACTIVE', paidUntil: new Date(base.getTime() + add), pastDueSince: null, suspendedAt: null, chargeAttempts: 0 },
      });
    }

    return this.listClubs();
  }

  // --- Джоба -----------------------------------------------------------------

  /** Один проход по всем подпискам (или по одному клубу — для смоука). */
  async runOnce(now = new Date(), onlyTenantId: string | null = null): Promise<{ steps: Record<string, number> }> {
    const subs = await this.prisma.tenantSubscription.findMany({
      where: { status: { notIn: ['EXEMPT', 'SUSPENDED'] }, ...(onlyTenantId ? { tenantId: onlyTenantId } : {}) },
      select: SUBSCRIPTION_SELECT,
    });
    const steps: Record<string, number> = {};

    for (const sub of subs) {
      const step = billingStep(
        {
          status: sub.status as PlatformStatus,
          trialEndsAt: sub.trialEndsAt,
          paidUntil: sub.paidUntil,
          autoRenew: sub.autoRenew,
          hasCard: sub.savedPaymentMethodId !== null,
          pastDueSince: sub.pastDueSince,
          chargeAttempts: sub.chargeAttempts,
          lastChargeAttemptAt: sub.lastChargeAttemptAt,
        },
        now,
      );

      steps[step.kind] = (steps[step.kind] ?? 0) + 1;

      try {
        await this.apply(sub, step, now);
      } catch (error) {
        // Один клуб с ошибкой не останавливает остальные.
        this.logger.error(`Подписка клуба ${sub.tenant.slug}: ${step.kind} не выполнен`, error as Error);
      }
    }

    return { steps };
  }

  private async apply(sub: SubscriptionRow, step: BillingStep, now: Date): Promise<void> {
    switch (step.kind) {
      case 'none':
        return;
      case 'remind':
        await this.notifyOwners(sub, 'SUBSCRIPTION_REMINDER', `billing-remind:${sub.tenantId}:${step.endsAt.toISOString()}:${step.days}`, now, {
          trial: sub.status === 'TRIAL',
          until: step.endsAt.toISOString(),
          plan: sub.plan?.name ?? null,
          amount: sub.priceAtPurchase,
          autoCharge: sub.status === 'ACTIVE' && sub.autoRenew && sub.savedPaymentMethodId !== null,
        });
        return;
      case 'charge':
        await this.autoCharge(sub, now);
        return;
      case 'past_due':
        await this.markPastDue(sub.tenantId, step.since, now);
        return;
      case 'suspend':
        await this.suspend(sub, now);
        return;
    }
  }

  /** Автосписание по сохранённой карте. Неудача — просрочка, повтор через сутки. */
  private async autoCharge(sub: SubscriptionRow, now: Date): Promise<void> {
    if (!sub.planId || sub.priceAtPurchase === null || !sub.savedPaymentMethodId || !sub.plan) {
      await this.markPastDue(sub.tenantId, sub.paidUntil ?? now, now);
      return;
    }

    await this.prisma.tenantSubscription.update({
      where: { tenantId: sub.tenantId },
      data: { lastChargeAttemptAt: now, chargeAttempts: { increment: 1 } },
    });

    const payment = await this.prisma.platformPayment.create({
      data: { tenantId: sub.tenantId, planId: sub.planId, amount: sub.priceAtPurchase, method: 'CARD', autoCharge: true },
      select: { id: true },
    });

    let remote: ProviderPayment;

    try {
      remote = await this.provider.chargeSaved({
        amount: sub.priceAtPurchase,
        description: `КНТ: продление доступа клуба «${sub.tenant.name}», тариф «${sub.plan.name}»`,
        paymentMethodId: sub.savedPaymentMethodId,
        idempotenceKey: payment.id,
        metadata: { platformPaymentId: payment.id, tenantId: sub.tenantId },
      });
    } catch {
      await this.fail(payment.id, 'Платёжный сервис не ответил', now);
      return;
    }

    await this.prisma.platformPayment.update({ where: { id: payment.id }, data: { providerPaymentId: remote.id } });
    await this.applyProviderPayment(remote, now);
  }

  /** Неоплачено — клуб работает ещё 3 дня; руководителю — сообщение. */
  private async markPastDue(tenantId: string, since: Date, now: Date): Promise<void> {
    const updated = await this.prisma.tenantSubscription.updateMany({
      where: { tenantId, status: { in: ['TRIAL', 'ACTIVE'] } },
      data: { status: 'PAST_DUE', pastDueSince: since },
    });

    if (updated.count === 0) return;

    const sub = await this.ensure(tenantId);
    await this.notifyOwners(sub, 'SUBSCRIPTION_PAST_DUE', `billing-past-due:${tenantId}:${since.toISOString()}`, now, {
      until: graceUntil(since).toISOString(),
    });
  }

  /**
   * Приостановка: доступ закрыт, все будущие записи клуба отменяются с
   * полным возвратом (решение владельца от 02.10.2026). Статус ставится
   * первым — новые записи после этого уже не пройдут (ClubContextGuard), —
   * а отмена идёт по одной записи в своей транзакции, как у джобы неявок.
   */
  private async suspend(sub: SubscriptionRow, now: Date): Promise<void> {
    const updated = await this.prisma.tenantSubscription.updateMany({
      where: { tenantId: sub.tenantId, status: 'PAST_DUE' },
      data: { status: 'SUSPENDED', suspendedAt: now },
    });

    if (updated.count === 0) return;

    const cancelled = await this.cancelFutureEntries(sub.tenantId, now);

    await this.notifyOwners(sub, 'SUBSCRIPTION_SUSPENDED', `billing-suspended:${sub.tenantId}:${now.toISOString()}`, now, {
      until: now.toISOString(),
      cancelled,
    });
  }

  /** Все будущие записи клуба — отменой без денег; визиты абонементов возвращаются. */
  async cancelFutureEntries(tenantId: string, now: Date): Promise<number> {
    const [tables, trainings, tournaments] = await Promise.all([
      this.prisma.tableBooking.findMany({
        where: { tenantId, status: BookingStatus.BOOKED, startsAt: { gt: now } },
        select: { id: true, subscriptionId: true },
      }),
      this.prisma.trainingBooking.findMany({
        where: { tenantId, status: BookingStatus.BOOKED, session: { startsAt: { gt: now } } },
        select: { id: true, subscriptionId: true },
      }),
      this.prisma.tournamentRegistration.findMany({
        where: { tenantId, status: BookingStatus.BOOKED, tournament: { startsAt: { gt: now } } },
        select: { id: true, subscriptionId: true },
      }),
    ]);

    let count = 0;
    const entries = [
      ...tables.map((row) => ({ ...row, kind: 'TABLE' as const })),
      ...trainings.map((row) => ({ ...row, kind: 'TRAINING' as const })),
      ...tournaments.map((row) => ({ ...row, kind: 'TOURNAMENT' as const })),
    ];

    for (const entry of entries) {
      const done = await this.prisma.$transaction(async (tx) => {
        const data = { status: BookingStatus.CANCELLED, cancelledAt: now, chargeRatio: 0 };
        const where = { id: entry.id, status: BookingStatus.BOOKED };
        const updated =
          entry.kind === 'TABLE'
            ? await tx.tableBooking.updateMany({ where, data })
            : entry.kind === 'TRAINING'
              ? await tx.trainingBooking.updateMany({ where, data })
              : await tx.tournamentRegistration.updateMany({ where, data });

        if (updated.count === 0) return false;

        if (entry.subscriptionId) {
          await this.subscriptions.settleInTx(tx, tenantId, entry.subscriptionId, true, false, linkOf(entry.kind, entry.id));
        }

        await tx.auditLog.create({
          data: {
            tenantId,
            action: AuditAction.BOOKING_CANCELLED,
            actorType: ActorType.SYSTEM_JOB,
            entityType: ENTITY_TYPE[entry.kind],
            entityId: entry.id,
            before: { status: BookingStatus.BOOKED },
            after: { status: BookingStatus.CANCELLED, chargeRatio: 0 },
            reason: 'Подписка клуба на КНТ приостановлена за неоплату — отмена с полным возвратом',
          },
        });

        await this.clients.entryCancelled(tx, tenantId, entry.kind, entry.id, 'club', 'CLUB_SUSPENDED');

        return true;
      });

      if (done) count += 1;
    }

    return count;
  }

  // --- Проведение платежей ------------------------------------------------------

  private async applyProviderPayment(remote: ProviderPayment, now = new Date()): Promise<void> {
    const payment = await this.prisma.platformPayment.findUnique({
      where: { providerPaymentId: remote.id },
      select: { id: true, status: true },
    });

    if (!payment || payment.status !== 'PENDING') return;

    if (remote.status === 'succeeded') {
      await this.settle(payment.id, now, { methodId: remote.paymentMethodId, title: remote.paymentMethodTitle });
    } else if (remote.status === 'canceled') {
      await this.fail(payment.id, failureText(remote.cancellationReason), now);
    }
  }

  /**
   * Деньги пришли: платёж проведён, срок продлён, акты за каждый месяц
   * заведены, руководителю — сообщение. Одна транзакция, подписка — под
   * блокировкой: два проведения одновременно не продлят срок дважды.
   */
  private async settle(paymentId: string, now: Date, card: { methodId: string | null; title: string | null } | null): Promise<void> {
    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.platformPayment.findUniqueOrThrow({
        where: { id: paymentId },
        select: { tenantId: true, amount: true, planId: true, method: true, plan: { select: { periodMonths: true, name: true } } },
      });

      await lockSubscription(tx, payment.tenantId);
      const sub = await tx.tenantSubscription.findUniqueOrThrow({
        where: { tenantId: payment.tenantId },
        select: { status: true, paidUntil: true, trialEndsAt: true, savedPaymentMethodId: true, paymentMethodTitle: true },
      });
      const { from, to } = paidPeriod(
        { status: sub.status as PlatformStatus, paidUntil: sub.paidUntil, trialEndsAt: sub.trialEndsAt },
        now,
        payment.plan.periodMonths,
      );

      const updated = await tx.platformPayment.updateMany({
        where: { id: paymentId, status: 'PENDING' },
        data: { status: 'SUCCEEDED', paidAt: now, periodFrom: from, periodTo: to },
      });

      if (updated.count === 0) return null;

      const methodId = card?.methodId ?? (payment.method === 'CARD' ? sub.savedPaymentMethodId : null);

      await tx.tenantSubscription.update({
        where: { tenantId: payment.tenantId },
        data: {
          status: 'ACTIVE',
          planId: payment.planId,
          priceAtPurchase: payment.amount,
          paidUntil: to,
          trialEndsAt: null,
          pastDueSince: null,
          suspendedAt: null,
          chargeAttempts: 0,
          lastChargeAttemptAt: null,
          ...(payment.method === 'CARD' && methodId
            ? { savedPaymentMethodId: methodId, paymentMethodTitle: card?.title ?? sub.paymentMethodTitle, nextChargeDate: to }
            : {}),
        },
      });

      const acts = monthlyActs(from, to, payment.amount);
      const last = await tx.platformAct.aggregate({ _max: { number: true } });
      let number = last._max.number ?? 0;

      for (const act of acts) {
        number += 1;
        await tx.platformAct.create({
          data: { tenantId: payment.tenantId, paymentId, number, periodFrom: act.from, periodTo: act.to, amount: act.amount },
        });
      }

      return { tenantId: payment.tenantId, to, amount: payment.amount, plan: payment.plan.name };
    });

    if (!result) return;

    const sub = await this.ensure(result.tenantId);
    await this.notifyOwners(sub, 'SUBSCRIPTION_PAID', `billing-paid:${paymentId}`, now, {
      until: result.to.toISOString(),
      plan: result.plan,
      amount: result.amount,
    });
  }

  /** Платёж не прошёл. Автосписание — просрочка с конца срока. */
  private async fail(paymentId: string, reason: string, now: Date): Promise<void> {
    const payment = await this.prisma.platformPayment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { tenantId: true, autoCharge: true },
    });
    const updated = await this.prisma.platformPayment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: { status: 'FAILED' satisfies PlatformPaymentStatus, failureReason: reason },
    });

    if (updated.count === 0 || !payment.autoCharge) return;

    const sub = await this.ensure(payment.tenantId);
    await this.markPastDue(payment.tenantId, sub.paidUntil ?? now, now);
  }

  // --- Вспомогательное ---------------------------------------------------------

  /** Подписка клуба; нет строки — заводится пробная (клуб создан без неё). */
  async ensure(tenantId: string): Promise<SubscriptionRow> {
    const found = await this.prisma.tenantSubscription.findUnique({ where: { tenantId }, select: SUBSCRIPTION_SELECT });

    if (found) return found;

    await this.prisma.tenantSubscription.createMany({
      data: [{ tenantId, status: 'TRIAL', trialEndsAt: new Date(Date.now() + TRIAL_DAYS * DAY_MS) }],
      skipDuplicates: true,
    });

    return this.prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId }, select: SUBSCRIPTION_SELECT });
  }

  private refuseExempt(sub: SubscriptionRow): void {
    if (sub.status === 'EXEMPT') {
      throw new ConflictException('Клуб на КНТ без оплаты — платить подписку не нужно');
    }
  }

  private async activePlan(planId: string) {
    const plan = await this.prisma.platformPlan.findFirst({
      where: { id: planId, isActive: true },
      select: { id: true, name: true, price: true, periodMonths: true },
    });

    if (!plan) throw new BadRequestException('Такого тарифа нет');

    return plan;
  }

  private async tenantIdOf(slug: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug }, select: { id: true } });

    if (!tenant) throw new NotFoundException('Клуб не найден');

    return tenant.id;
  }

  private async notifyOwners(
    sub: SubscriptionRow,
    type: NotificationType,
    dedupeKey: string,
    now: Date,
    rest: Omit<PlatformBillingPayload, 'club' | 'slug' | 'timezone'>,
  ): Promise<void> {
    const payload: PlatformBillingPayload = {
      club: sub.tenant.name,
      slug: sub.tenant.slug,
      timezone: await clubTimezone(this.prisma, sub.tenantId),
      ...rest,
    };

    await this.staff.toOwners(this.prisma, sub.tenantId, type, payload, dedupeKey, now);
  }

  private seller(): PlatformSeller | null {
    const get = <K extends keyof Env>(key: K) => this.config.get(key, { infer: true }) as string | undefined;
    const name = get('BILLING_SELLER_NAME');
    const inn = get('BILLING_SELLER_INN');
    const address = get('BILLING_SELLER_ADDRESS');

    if (!name || !inn || !address) return null;

    return {
      name,
      inn,
      address,
      kpp: get('BILLING_SELLER_KPP') ?? null,
      bank: get('BILLING_SELLER_BANK') ?? null,
      bik: get('BILLING_SELLER_BIK') ?? null,
      account: get('BILLING_SELLER_ACCOUNT') ?? null,
      corrAccount: get('BILLING_SELLER_CORR_ACCOUNT') ?? null,
    };
  }
}

const ENTITY_TYPE = { TABLE: 'TableBooking', TRAINING: 'TrainingBooking', TOURNAMENT: 'TournamentRegistration' } as const;

function linkOf(kind: 'TABLE' | 'TRAINING' | 'TOURNAMENT', id: string) {
  return kind === 'TABLE' ? { tableBookingId: id } : kind === 'TRAINING' ? { trainingBookingId: id } : { tournamentRegistrationId: id };
}

async function lockSubscription(tx: Tx, tenantId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "TenantSubscription" WHERE "tenantId" = ${tenantId} FOR UPDATE`;
}

function toPaymentView(row: Prisma.PlatformPaymentGetPayload<{ select: typeof PAYMENT_SELECT }>): PlatformPaymentView {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    method: row.method,
    status: row.status,
    amount: row.amount,
    planName: row.plan.name,
    autoCharge: row.autoCharge,
    invoiceNumber: row.invoiceNumber,
    periodFrom: row.periodFrom?.toISOString() ?? null,
    periodTo: row.periodTo?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    failureReason: row.failureReason,
    acts: row.acts.map((act) => ({
      id: act.id,
      number: act.number,
      periodFrom: act.periodFrom.toISOString(),
      periodTo: act.periodTo.toISOString(),
      amount: act.amount,
    })),
  };
}

function toRequisites(row: { legalName: string; inn: string; kpp: string | null; address: string; email: string }): ClubRequisitesView {
  return { legalName: row.legalName, inn: row.inn, kpp: row.kpp, address: row.address, email: row.email };
}

/** Причина отказа ЮKassa — словами руководителя. */
function failureText(reason: string | null): string {
  switch (reason) {
    case 'insufficient_funds':
      return 'Недостаточно денег на карте';
    case 'card_expired':
      return 'Срок действия карты истёк';
    case 'canceled_by_user':
    case 'expired_on_confirmation':
      return 'Оплата не подтверждена';
    case null:
      return 'Банк отклонил платёж';
    default:
      return `Банк отклонил платёж (${reason})`;
  }
}

/** «02.10.2026 — 02.11.2026». */
function period(from: Date, to: Date): string {
  const format = (date: Date) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);

  return `${format(from)} — ${format(to)}`;
}
