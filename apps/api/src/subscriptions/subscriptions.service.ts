import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, AuditAction, LedgerReason, Prisma } from '@yenisey/database';
import type {
  ClientSubscription,
  ClubLedgerPage,
  LedgerReasonView,
  PaidBySubscription,
  SubscriptionLedgerRow,
  PublicPlan,
  SubscriptionOffer,
  SubscriptionPlan,
} from '@yenisey/types';
import { MembershipService } from '../club/membership.service';
import { pickOffers } from './offer-rules';
import { PrismaService } from '../prisma/prisma.service';
import type { AdjustSubscriptionDto, ClubLedgerQueryDto, SubscriptionPlanDto } from './dto/subscription.dto';
import { lockSubscription, writeLedger, type LockedSubscription } from './subscription-ledger';
import {
  cleanNote,
  decideAdjustment,
  decideClose,
  decideLedger,
  decideMove,
  decidePlanCoverage,
  expiryOf,
  isActive,
  pickSubscription,
  type Decision,
  type EventFacts,
} from './subscription-rules';

/** К какой записи относится движение по визитам. */
export type EntryLink = { trainingBookingId: string } | { tournamentRegistrationId: string };

/** Откуда абонемент: продал сотрудник у стойки или оплачен онлайн. */
export type IssueOrigin = { issuedBy: string } | { paymentId: string };

export interface Actor {
  userId: string;
  ipAddress: string | null;
}

/**
 * Строка журнала так, как её показывают. Один набор колонок на историю одного
 * абонемента и на историю всего клуба: разойдясь, они показали бы одно и то же
 * движение по-разному.
 */
const LEDGER_SELECT = {
  id: true,
  createdAt: true,
  delta: true,
  balanceAfter: true,
  reason: true,
  note: true,
  createdBy: { select: { user: { select: { fullName: true } } } },
  trainingBooking: {
    select: { session: { select: { startsAt: true, trainingType: { select: { name: true } } } } },
  },
  tournamentRegistration: {
    select: { tournament: { select: { startsAt: true, tournamentType: { select: { name: true } } } } },
  },
} satisfies Prisma.SubscriptionLedgerSelect;

type LedgerRowData = Prisma.SubscriptionLedgerGetPayload<{ select: typeof LEDGER_SELECT }>;

function toLedgerRow(row: LedgerRowData): SubscriptionLedgerRow {
  const session = row.trainingBooking?.session;
  const tournament = row.tournamentRegistration?.tournament;

  return {
    id: row.id,
    at: row.createdAt.toISOString(),
    delta: row.delta,
    balanceAfter: row.balanceAfter,
    reason: row.reason as LedgerReasonView,
    note: row.note,
    by: row.createdBy?.user.fullName ?? null,
    entry: session
      ? { title: session.trainingType.name, startsAt: session.startsAt.toISOString() }
      : tournament
        ? { title: tournament.tournamentType.name, startsAt: tournament.startsAt.toISOString() }
        : null,
  };
}

const CLIENT_SUBSCRIPTION_SELECT = {
  id: true,
  remainingVisits: true,
  purchasedAt: true,
  expiresAt: true,
  priceAtPurchase: true,
  tenant: { select: { name: true, slug: true } },
  plan: {
    select: {
      name: true,
      coveredTrainingTypes: { select: { trainingType: { select: { name: true } } } },
      coveredTournamentTypes: { select: { tournamentType: { select: { name: true } } } },
    },
  },
} satisfies Prisma.SubscriptionSelect;

type ClientSubscriptionRow = Prisma.SubscriptionGetPayload<{ select: typeof CLIENT_SUBSCRIPTION_SELECT }>;

/**
 * Тарифы и абонементы: продажа, корректировка, история.
 *
 * Списание визита при записи, отмене и отметке живёт здесь же (шаг «списание»),
 * но журнал пишет только `writeLedger` — единственный его писатель.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
  ) {}

  // --- Тарифы --------------------------------------------------------------

  async listPlans(tenantId: string): Promise<SubscriptionPlan[]> {
    const now = new Date();

    const plans = await this.prisma.subscriptionPlan.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        visitsCount: true,
        durationDays: true,
        price: true,
        isActive: true,
        coveredTrainingTypes: { select: { trainingTypeId: true } },
        coveredTournamentTypes: { select: { tournamentTypeId: true } },
        _count: { select: { subscriptions: { where: activeWhere(now) } } },
      },
      // Варианты одного тарифа рядом: сначала по названию, внутри — от
      // меньшего пакета к большему, безлимит последним.
      orderBy: [{ name: 'asc' }, { visitsCount: { sort: 'asc', nulls: 'last' } }, { durationDays: 'asc' }],
    });

    return plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      visitsCount: plan.visitsCount,
      durationDays: plan.durationDays,
      price: plan.price,
      isActive: plan.isActive,
      trainingTypeIds: plan.coveredTrainingTypes.map((row) => row.trainingTypeId),
      tournamentTypeIds: plan.coveredTournamentTypes.map((row) => row.tournamentTypeId),
      activeSubscriptions: plan._count.subscriptions,
    }));
  }

  /**
   * Действующие тарифы клубов человека — отмеченных своими и тех, где он
   * клиент. Для пустого раздела «Абонементы» в кабинете: прайс, как цены залов.
   */
  async offersFor(userId: string): Promise<SubscriptionOffer[]> {
    const tenants = await this.prisma.tenant.findMany({
      where: {
        OR: [
          { favouritedBy: { some: { userId } } },
          { memberships: { some: { userId, role: 'CLIENT', deactivatedAt: null } } },
        ],
      },
      select: {
        slug: true,
        name: true,
        accentColor: true,
        phone: true,
        subscriptionPlans: PUBLIC_PLANS,
      },
      orderBy: { name: 'asc' },
    });

    return tenants
      .filter((tenant) => tenant.subscriptionPlans.length > 0)
      .map((tenant) => {
        const plans = tenant.subscriptionPlans.map(toPublicPlan);

        return {
          club: { slug: tenant.slug, name: tenant.name, accentColor: tenant.accentColor, phone: tenant.phone },
          plans: pickOffers(plans),
          totalPlans: plans.length,
        };
      });
  }

  /** Все действующие тарифы клуба — открыто, как цены залов в карточке клуба. */
  async publicPlans(tenantId: string): Promise<PublicPlan[]> {
    // Условие клуба — последним: общий `PUBLIC_PLANS` несёт свой `where`, и
    // разворот после него стёр бы tenantId — и отдал бы тарифы всех клубов.
    const plans = await this.prisma.subscriptionPlan.findMany({
      ...PUBLIC_PLANS,
      where: { ...PUBLIC_PLANS.where, tenantId },
    });

    return plans.map(toPublicPlan);
  }

  async createPlan(tenantId: string, dto: SubscriptionPlanDto): Promise<SubscriptionPlan> {
    const terms = planTerms(dto);
    const empty = { trainingTypeIds: [], tournamentTypeIds: [] };

    fail(decidePlanCoverage(empty, dto, 0));
    await this.assertTypes(tenantId, dto);

    // Связки — отдельными вставками, а не вложенным create: у них составные
    // ключи и с тарифом, и с типом по одному tenantId, и вложенная форма
    // Prisma такого общего поля не принимает.
    const id = await this.prisma.$transaction(async (tx) => {
      const created = await tx.subscriptionPlan.create({ data: { tenantId, ...terms }, select: { id: true } });

      await this.writeCoverage(tx, tenantId, created.id, dto);

      return created.id;
    });

    return this.findPlan(tenantId, id);
  }

  private async writeCoverage(
    tx: Prisma.TransactionClient,
    tenantId: string,
    planId: string,
    dto: { trainingTypeIds: string[]; tournamentTypeIds: string[] },
  ): Promise<void> {
    await tx.subscriptionPlanTrainingType.createMany({
      data: dto.trainingTypeIds.map((trainingTypeId) => ({ planId, trainingTypeId, tenantId })),
    });
    await tx.subscriptionPlanTournamentType.createMany({
      data: dto.tournamentTypeIds.map((tournamentTypeId) => ({ planId, tournamentTypeId, tenantId })),
    });
  }

  /**
   * Правка тарифа. Визиты, срок и цена меняют только БУДУЩИЕ продажи: у
   * проданного абонемента они уже зафиксированы. Покрытие читается вживую,
   * поэтому убирать из него услугу нельзя, пока по тарифу есть действующие
   * абонементы, — только добавлять.
   */
  async updatePlan(tenantId: string, id: string, dto: SubscriptionPlanDto): Promise<SubscriptionPlan> {
    const current = await this.findPlan(tenantId, id);
    const terms = planTerms(dto);

    fail(decidePlanCoverage(current, dto, current.activeSubscriptions));
    await this.assertTypes(tenantId, dto);

    await this.prisma.$transaction(async (tx) => {
      await tx.subscriptionPlan.update({ where: { id }, data: terms });
      await tx.subscriptionPlanTrainingType.deleteMany({ where: { planId: id } });
      await tx.subscriptionPlanTournamentType.deleteMany({ where: { planId: id } });
      await this.writeCoverage(tx, tenantId, id, dto);
    });

    return this.findPlan(tenantId, id);
  }

  private async findPlan(tenantId: string, id: string): Promise<SubscriptionPlan> {
    const plan = (await this.listPlans(tenantId)).find((row) => row.id === id);

    if (!plan) {
      throw new NotFoundException('Тариф не найден');
    }

    return plan;
  }

  /**
   * Типы, которые тариф покрывает, — этого клуба. Чужой тип база и так не
   * примет (ключ составной), но ответом 500; здесь — внятное 400.
   */
  private async assertTypes(
    tenantId: string,
    dto: { trainingTypeIds: string[]; tournamentTypeIds: string[] },
  ): Promise<void> {
    const trainingIds = [...new Set(dto.trainingTypeIds)];
    const tournamentIds = [...new Set(dto.tournamentTypeIds)];

    const [trainings, tournaments] = await Promise.all([
      this.prisma.trainingType.count({ where: { tenantId, id: { in: trainingIds } } }),
      this.prisma.tournamentType.count({ where: { tenantId, id: { in: tournamentIds } } }),
    ]);

    if (trainings !== trainingIds.length || tournaments !== tournamentIds.length) {
      throw new BadRequestException('В тарифе указана услуга, которой в клубе нет');
    }

    if (trainingIds.length !== dto.trainingTypeIds.length || tournamentIds.length !== dto.tournamentTypeIds.length) {
      throw new BadRequestException('Одна и та же услуга указана в тарифе дважды');
    }
  }

  // --- Продажа -------------------------------------------------------------

  /**
   * Выдать абонемент.
   *
   * Одна точка входа на любой способ продажи: сейчас её зовёт администратор у
   * стойки, потом позовёт подтверждение онлайн-оплаты — с платежом вместо
   * продавца. Цена, визиты и срок снимаются с тарифа в момент продажи.
   */
  async issue(
    tenantId: string,
    clientId: string,
    planId: string,
    origin: IssueOrigin,
    hallId?: string,
  ): Promise<ClientSubscription> {
    const member = await this.prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId: clientId, tenantId } },
      select: { deactivatedAt: true, user: { select: { deactivatedAt: true, anonymizedAt: true } } },
    });

    if (!member || member.user.anonymizedAt) {
      throw new NotFoundException('Человек не найден в этом клубе');
    }

    if (member.deactivatedAt || member.user.deactivatedAt) {
      throw new ConflictException('Человек отключён — абонемент ему не продаётся');
    }

    const plan = await this.prisma.subscriptionPlan.findFirst({
      where: { id: planId, tenantId },
      select: { visitsCount: true, durationDays: true, price: true, isActive: true },
    });

    if (!plan) {
      throw new NotFoundException('Тариф не найден');
    }

    if (!plan.isActive) {
      throw new BadRequestException('Тариф снят с продажи');
    }

    // Абонемент ссылается на анкету клиента. У сотрудника её может не быть —
    // тренер тоже покупает абонемент, чтобы ходить на чужие группы.
    await this.membership.ensureClient(tenantId, clientId);

    const hall = await this.saleHall(tenantId, hallId);
    const now = new Date();
    const issuedBy = 'issuedBy' in origin ? origin.issuedBy : null;

    const id = await this.prisma.$transaction(async (tx) => {
      const created = await tx.subscription.create({
        data: {
          tenantId,
          clientId,
          planId,
          remainingVisits: plan.visitsCount,
          purchasedAt: now,
          expiresAt: expiryOf(now, plan.durationDays, hall.timezone),
          priceAtPurchase: plan.price,
          soldAtHallId: hall.id,
          issuedByUserId: issuedBy,
          paymentId: 'paymentId' in origin ? origin.paymentId : null,
        },
        select: { id: true },
      });

      await writeLedger(tx, {
        tenantId,
        subscriptionId: created.id,
        delta: plan.visitsCount ?? 0,
        balanceAfter: plan.visitsCount,
        reason: LedgerReason.PURCHASE,
        createdByUserId: issuedBy,
      });

      return created.id;
    });

    return this.one(tenantId, clientId, id);
  }

  /**
   * Ручное действие администратора: корректировка визитов или досрочное
   * закрытие безлимита. С причиной — в журнале абонемента и в журнале аудита.
   * Возврат абонемента оформляется этим же: корректировкой до нуля.
   */
  async adjust(
    tenantId: string,
    clientId: string,
    subscriptionId: string,
    dto: AdjustSubscriptionDto,
    actor: Actor,
  ): Promise<ClientSubscription> {
    const note = cleanNote(dto.reason);

    if (dto.close === true && dto.delta !== undefined) {
      throw new BadRequestException('Либо корректировка визитов, либо закрытие — не всё сразу');
    }

    await this.prisma.$transaction(async (tx) => {
      const sub = await lockSubscription(tx, tenantId, subscriptionId);

      if (!sub || sub.clientId !== clientId) {
        throw new NotFoundException('Абонемент не найден');
      }

      const before = { remainingVisits: sub.remainingVisits, expiresAt: sub.expiresAt?.toISOString() ?? null };
      let after = before;

      if (dto.close === true) {
        const decision = fail(decideClose(sub, note, new Date()));

        await tx.subscription.update({ where: { id: sub.id }, data: { expiresAt: decision.expiresAt } });
        await writeLedger(tx, {
          tenantId,
          subscriptionId: sub.id,
          delta: 0,
          balanceAfter: null,
          reason: LedgerReason.ADMIN_ADJUSTMENT,
          createdByUserId: actor.userId,
          note,
        });

        after = { ...before, expiresAt: decision.expiresAt.toISOString() };
      } else {
        const decision = fail(decideAdjustment(sub, dto.delta ?? 0, note));

        await writeLedger(tx, {
          tenantId,
          subscriptionId: sub.id,
          delta: decision.delta,
          balanceAfter: decision.balanceAfter,
          reason: LedgerReason.ADMIN_ADJUSTMENT,
          createdByUserId: actor.userId,
          note,
        });

        after = { ...before, remainingVisits: decision.balanceAfter };
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          action: AuditAction.SUBSCRIPTION_BALANCE_ADJUSTED,
          actorType: ActorType.USER,
          actorUserId: actor.userId,
          entityType: 'Subscription',
          entityId: sub.id,
          before,
          after,
          reason: note,
          ipAddress: actor.ipAddress,
        },
      });
    });

    return this.one(tenantId, clientId, subscriptionId);
  }

  // --- Списание -----------------------------------------------------------

  /**
   * Подобрать абонемент, который заплатит за запись, — под блокировкой.
   *
   * Зовётся ВНУТРИ транзакции записи, после блокировки её занятия: порядок
   * блокировок везде один — запись или занятие, потом абонемент. Подходящие
   * абонементы блокируются все сразу и по возрастанию id: две записи одного
   * человека на разные занятия иначе могли бы взять их в разном порядке и
   * ждать друг друга вечно. Выбирается уже из заблокированных — остаток,
   * прочитанный до блокировки, мог устареть.
   */
  async reserveInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    clientId: string,
    event: EventFacts,
  ): Promise<LockedSubscription | null> {
    const candidates = await tx.subscription.findMany({
      where: {
        tenantId,
        clientId,
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: event.startsAt } }] },
          { OR: [{ remainingVisits: null }, { remainingVisits: { gt: 0 } }] },
        ],
        plan:
          event.kind === 'TRAINING'
            ? { coveredTrainingTypes: { some: { trainingTypeId: event.typeId } } }
            : { coveredTournamentTypes: { some: { tournamentTypeId: event.typeId } } },
      },
      select: { id: true },
    });

    if (candidates.length === 0) {
      return null;
    }

    const ids = candidates.map((row) => row.id);
    const locked = await tx.$queryRaw<LockedSubscription[]>`
      SELECT "id", "clientId", "remainingVisits", "expiresAt"
      FROM "Subscription"
      WHERE "id" IN (${Prisma.join(ids)})
      ORDER BY "id"
      FOR UPDATE`;

    // Покрытие уже отфильтровано запросом, поэтому правилам его подсказываем
    // как «покрыто»: выбор решают срок и остаток под блокировкой.
    const typeIds = { trainingTypeIds: [event.typeId], tournamentTypeIds: [event.typeId] };

    return pickSubscription(
      locked.map((sub) => ({ ...sub, ...typeIds })),
      event,
    );
  }

  /** Списать визит за только что созданную запись. Абонемент — из `reserveInTx`. */
  async chargeInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sub: LockedSubscription,
    link: EntryLink,
  ): Promise<void> {
    const move = fail(decideMove(sub.remainingVisits, -1));

    await writeLedger(tx, {
      tenantId,
      subscriptionId: sub.id,
      delta: move.delta,
      balanceAfter: move.balanceAfter,
      reason: LedgerReason.VISIT_CHARGED,
      ...link,
    });
  }

  /**
   * Свести переход записи по абонементу в журнал: вернуть визит, списать
   * снова или ничего.
   *
   * `before` и `after` — израсходован ли визит до и после перехода (см.
   * `consumed`). Неявка после записи ничего не пишет: визит уже списан, это и
   * значит «сгорел». Вызывается внутри той же транзакции, что меняет запись,
   * уже после её обновления.
   */
  async settleInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    subscriptionId: string,
    before: boolean,
    after: boolean,
    link: EntryLink,
  ): Promise<void> {
    const step = decideLedger(before, after);

    if (step === null) {
      return;
    }

    const sub = await lockSubscription(tx, tenantId, subscriptionId);

    if (!sub) {
      throw new NotFoundException('Абонемент записи не найден');
    }

    const move = fail(decideMove(sub.remainingVisits, step));

    await writeLedger(tx, {
      tenantId,
      subscriptionId,
      delta: move.delta,
      balanceAfter: move.balanceAfter,
      reason: step < 0 ? LedgerReason.VISIT_CHARGED : LedgerReason.VISIT_REFUNDED,
      ...link,
    });
  }

  /** Мягкое ли правило клуба: визит при отмене возвращается всегда. */
  async softRule(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { subscriptionBurnsOnNoShowOnly: true },
    });

    return tenant.subscriptionBurnsOnNoShowOnly;
  }

  /**
   * Чем будет оплачена запись на каждое из мероприятий — для кнопки «Записаться».
   *
   * Без блокировок и одним запросом на все мероприятия: это подсказка, а не
   * обещание. Настоящий выбор делает `reserveInTx` в момент записи — и если
   * за это время визиты кончились, запись честно пойдёт по цене.
   */
  async payWithFor(
    tenantId: string,
    clientId: string,
    events: readonly (EventFacts & { id: string })[],
  ): Promise<Map<string, PaidBySubscription>> {
    const subs = await this.prisma.subscription.findMany({
      where: {
        tenantId,
        clientId,
        OR: [{ remainingVisits: null }, { remainingVisits: { gt: 0 } }],
      },
      select: {
        id: true,
        clientId: true,
        remainingVisits: true,
        expiresAt: true,
        plan: {
          select: {
            name: true,
            coveredTrainingTypes: { select: { trainingTypeId: true } },
            coveredTournamentTypes: { select: { tournamentTypeId: true } },
          },
        },
      },
    });

    const facts = subs.map((sub) => ({
      id: sub.id,
      remainingVisits: sub.remainingVisits,
      expiresAt: sub.expiresAt,
      planName: sub.plan.name,
      trainingTypeIds: sub.plan.coveredTrainingTypes.map((row) => row.trainingTypeId),
      tournamentTypeIds: sub.plan.coveredTournamentTypes.map((row) => row.tournamentTypeId),
    }));

    const result = new Map<string, PaidBySubscription>();

    for (const event of events) {
      const chosen = pickSubscription(facts, event);

      if (chosen) {
        result.set(event.id, { subscriptionId: chosen.id, planName: chosen.planName });
      }
    }

    return result;
  }

  // --- Чтение --------------------------------------------------------------

  /** Абонементы человека в клубе — для карточки у администратора. */
  async forCard(tenantId: string, clientId: string): Promise<ClientSubscription[]> {
    const rows = await this.prisma.subscription.findMany({
      where: { tenantId, clientId },
      select: CLIENT_SUBSCRIPTION_SELECT,
    });

    return sortSubscriptions(rows.map((row) => toClientSubscription(row, new Date())));
  }

  /** Свои абонементы по всем клубам — для кабинета клиента. */
  async forClient(userId: string): Promise<ClientSubscription[]> {
    const rows = await this.prisma.subscription.findMany({
      where: { clientId: userId },
      select: CLIENT_SUBSCRIPTION_SELECT,
    });

    return sortSubscriptions(rows.map((row) => toClientSubscription(row, new Date())));
  }

  /** История движений абонемента — свежие сверху. */
  async ledger(tenantId: string, clientId: string, subscriptionId: string): Promise<SubscriptionLedgerRow[]> {
    const sub = await this.prisma.subscription.findFirst({
      where: { id: subscriptionId, tenantId, clientId },
      select: { id: true },
    });

    if (!sub) {
      throw new NotFoundException('Абонемент не найден');
    }

    const rows = await this.prisma.subscriptionLedger.findMany({
      where: { subscriptionId },
      select: LEDGER_SELECT,
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(toLedgerRow);
  }

  /**
   * История абонементов всего клуба — движение за движением.
   *
   * Отдельно от истории одного абонемента: администратор приходит сюда не с
   * вопросом «что было у Иванова», а с вопросом «что вообще происходило» —
   * деньги приняли вне системы, и журнал остаётся единственным следом.
   * Поиск по человеку на случай, когда вопрос всё-таки про Иванова.
   */
  async clubLedger(tenantId: string, query: ClubLedgerQueryDto): Promise<ClubLedgerPage> {
    const search = query.search?.trim();
    const where: Prisma.SubscriptionLedgerWhereInput = {
      tenantId,
      ...(query.personId ? { subscription: { clientId: query.personId } } : {}),
      ...(search
        ? {
            subscription: {
              ...(query.personId ? { clientId: query.personId } : {}),
              client: { membership: { user: { fullName: { contains: search, mode: 'insensitive' } } } },
            },
          }
        : {}),
    };

    const limit = Math.min(query.limit ?? 50, 200);

    const [total, rows] = await Promise.all([
      this.prisma.subscriptionLedger.count({ where }),
      this.prisma.subscriptionLedger.findMany({
        where,
        select: {
          ...LEDGER_SELECT,
          subscriptionId: true,
          subscription: {
            select: {
              plan: { select: { name: true } },
              client: { select: { userId: true, membership: { select: { user: { select: { fullName: true } } } } } },
            },
          },
        },
        // Одной секундой могут лечь и продажа, и списание первого визита:
        // id вторым ключом держит порядок неизменным между страницами.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: query.offset ?? 0,
      }),
    ]);

    return {
      total,
      items: rows.map((row) => ({
        ...toLedgerRow(row),
        subscriptionId: row.subscriptionId,
        planName: row.subscription.plan.name,
        person: { id: row.subscription.client.userId, fullName: row.subscription.client.membership.user.fullName },
      })),
    };
  }

  private async one(tenantId: string, clientId: string, id: string): Promise<ClientSubscription> {
    const row = await this.prisma.subscription.findFirst({
      where: { id, tenantId, clientId },
      select: CLIENT_SUBSCRIPTION_SELECT,
    });

    if (!row) {
      throw new NotFoundException('Абонемент не найден');
    }

    return toClientSubscription(row, new Date());
  }

  /**
   * Зал, в котором продан абонемент.
   *
   * По его поясу считается конец срока, и в его деньгах дня видна продажа
   * (решение владельца от 20.09.2026). Пояс живёт у зала, а не у клуба, и у
   * залов в разных регионах «до конца последнего дня» наступает в разное время.
   *
   * У клуба с одним залом спрашивать не о чем — он и подставляется. С
   * несколькими зал обязателен: молча взять первый значило бы посчитать срок по
   * чужим часам и показать выручку не той стойке.
   */
  private async saleHall(tenantId: string, hallId: string | undefined): Promise<{ id: string; timezone: string }> {
    if (hallId) {
      const hall = await this.prisma.hall.findFirst({
        where: { id: hallId, tenantId },
        select: { id: true, timezone: true },
      });

      if (!hall) {
        throw new NotFoundException('Зал не найден');
      }

      return hall;
    }

    const halls = await this.prisma.hall.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, timezone: true },
      take: 2,
    });

    if (halls.length === 0) {
      throw new BadRequestException('У клуба нет ни одного зала — срок абонемента считать не по чему');
    }

    if (halls.length > 1) {
      throw new BadRequestException('Укажите зал продажи');
    }

    return halls[0]!;
  }
}

/** Условие «абонемент действует сейчас» — то же, что `isActive`, но для базы. */
function activeWhere(now: Date): Prisma.SubscriptionWhereInput {
  return {
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      { OR: [{ remainingVisits: null }, { remainingVisits: { gt: 0 } }] },
    ],
  };
}

function planTerms(dto: SubscriptionPlanDto) {
  const name = dto.name.trim();

  if (!name) {
    throw new BadRequestException('Назовите тариф');
  }

  if (dto.visitsCount === null && dto.durationDays === null) {
    throw new BadRequestException('Безлимит без срока клуб не продаёт — укажите визиты или срок');
  }

  return {
    name,
    visitsCount: dto.visitsCount,
    durationDays: dto.durationDays,
    price: dto.price,
    isActive: dto.isActive ?? true,
  };
}

function toClientSubscription(row: ClientSubscriptionRow, now: Date): ClientSubscription {
  return {
    id: row.id,
    club: row.tenant,
    planName: row.plan.name,
    remainingVisits: row.remainingVisits,
    purchasedAt: row.purchasedAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    priceAtPurchase: row.priceAtPurchase,
    active: isActive(row, now),
    covers: [
      ...row.plan.coveredTrainingTypes.map((item) => item.trainingType.name),
      ...row.plan.coveredTournamentTypes.map((item) => item.tournamentType.name),
    ],
  };
}

/** Действующие сверху, внутри — свежие первыми. */
function sortSubscriptions(subs: ClientSubscription[]): ClientSubscription[] {
  return subs.sort(
    (a, b) => Number(b.active) - Number(a.active) || b.purchasedAt.localeCompare(a.purchasedAt),
  );
}

/** Отказ правила — в ответ с тем же кодом, что назвало правило. */
function fail<T>(decision: Decision<T>): { ok: true } & T {
  if (decision.ok) {
    return decision;
  }

  throw decision.status === 409
    ? new ConflictException(decision.message)
    : new BadRequestException(decision.message);
}

/** Действующие тарифы в том виде, в каком их видит посетитель. */
const PUBLIC_PLANS = {
  where: { isActive: true },
  select: {
    id: true,
    name: true,
    visitsCount: true,
    durationDays: true,
    price: true,
    coveredTrainingTypes: { select: { trainingType: { select: { name: true } } } },
    coveredTournamentTypes: { select: { tournamentType: { select: { name: true } } } },
  } as const,
  // Варианты одного тарифа рядом: по названию, внутри — от меньшего пакета.
  orderBy: [
    { name: 'asc' },
    { visitsCount: { sort: 'asc', nulls: 'last' } },
    { durationDays: 'asc' },
  ] satisfies Prisma.SubscriptionPlanOrderByWithRelationInput[],
};

function toPublicPlan(plan: {
  id: string;
  name: string;
  visitsCount: number | null;
  durationDays: number | null;
  price: number;
  coveredTrainingTypes: { trainingType: { name: string } }[];
  coveredTournamentTypes: { tournamentType: { name: string } }[];
}): PublicPlan {
  return {
    id: plan.id,
    name: plan.name,
    visitsCount: plan.visitsCount,
    durationDays: plan.durationDays,
    price: plan.price,
    covers: [
      ...plan.coveredTrainingTypes.map((row) => row.trainingType.name),
      ...plan.coveredTournamentTypes.map((row) => row.tournamentType.name),
    ],
  };
}
