import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, AuditAction, LedgerReason, Prisma } from '@yenisey/database';
import type {
  ClientSubscription,
  LedgerReasonView,
  SubscriptionLedgerRow,
  SubscriptionPlan,
} from '@yenisey/types';
import { MembershipService } from '../club/membership.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AdjustSubscriptionDto, SubscriptionPlanDto } from './dto/subscription.dto';
import { lockSubscription, writeLedger } from './subscription-ledger';
import {
  cleanNote,
  decideAdjustment,
  decideClose,
  decidePlanCoverage,
  expiryOf,
  isActive,
  type Decision,
} from './subscription-rules';

/**
 * Пояс, если у клуба ещё нет ни одного зала. Тот же, что стоит по умолчанию у
 * зала в схеме: клуб без залов занятий не проводит, и срок его абонемента
 * пока ни на что не влияет.
 */
const FALLBACK_TIMEZONE = 'Asia/Krasnoyarsk';

/** Откуда абонемент: продал сотрудник у стойки или оплачен онлайн. */
export type IssueOrigin = { issuedBy: string } | { paymentId: string };

export interface Actor {
  userId: string;
  ipAddress: string | null;
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
  async issue(tenantId: string, clientId: string, planId: string, origin: IssueOrigin): Promise<ClientSubscription> {
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

    const timezone = await this.clubTimezone(tenantId);
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
          expiresAt: expiryOf(now, plan.durationDays, timezone),
          priceAtPurchase: plan.price,
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
      select: {
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
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => {
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
    });
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
   * Пояс, по которому считается конец срока.
   *
   * Пояс живёт у зала, а абонемент — клубный. Берётся основной зал клуба —
   * заведённый первым. У «Енисея» все залы в одном поясе; когда появится клуб с
   * залами в разных регионах, срок, возможно, придётся считать по залу продажи.
   */
  private async clubTimezone(tenantId: string): Promise<string> {
    const hall = await this.prisma.hall.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: { timezone: true },
    });

    return hall?.timezone ?? FALLBACK_TIMEZONE;
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
