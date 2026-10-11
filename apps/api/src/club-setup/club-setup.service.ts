import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@yenisey/database';
import type { ClubCreateRequest, ClubOpening } from '@yenisey/types';
import { BillingService } from '../billing/billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { openingProblems, slugProblem } from './opening-rules';

/** Политика отмены нового клуба — как у «Енисея» и в ТЗ: за час — бесплатно, позже — половина. */
const DEFAULT_TIERS = [
  { minMinutesBeforeStart: 60, chargePercent: 0 },
  { minMinutesBeforeStart: 0, chargePercent: 50 },
];

/**
 * Заведение и открытие клуба (решения владельца от 11.10.2026).
 *
 * Владелец платформы заводит клуб — из заявки или руками: название, код для
 * адреса, город и руководитель по почте уже зарегистрированной учётки (учёток
 * за людей мы не заводим). Клуб появляется ЧЕРНОВИКОМ: в поиске его нет,
 * страницу видят только свои, настройки применяются сразу, а не в полночь.
 * Открывает его руководитель клуба, когда готов хотя бы один зал с адресом и
 * столами; с открытия идут 7 пробных дней подписки.
 */
@Injectable()
export class ClubSetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  /** Владелец платформы заводит клуб-черновик. */
  async create(dto: ClubCreateRequest): Promise<{ slug: string }> {
    const name = dto.name.trim();
    const slug = dto.slug.trim();
    const problem = slugProblem(slug);

    if (problem) {
      throw new BadRequestException(problem);
    }

    if (name.length < 2 || name.length > 120) {
      throw new BadRequestException('Название клуба — от 2 до 120 знаков');
    }

    const [city, owner, application] = await Promise.all([
      this.prisma.city.findUnique({ where: { id: dto.cityId }, select: { id: true } }),
      this.prisma.user.findFirst({
        where: { email: dto.ownerEmail.trim().toLowerCase(), deactivatedAt: null, anonymizedAt: null },
        select: { id: true },
      }),
      dto.applicationId
        ? this.prisma.clubApplication.findUnique({ where: { id: dto.applicationId }, select: { id: true, tenantId: true } })
        : null,
    ]);

    if (!city) {
      throw new BadRequestException('Город не найден — выберите из подсказок');
    }

    if (!owner) {
      throw new BadRequestException(
        'Учётки с такой почтой нет. Пусть руководитель клуба сначала зарегистрируется на сайте — потом заведите клуб на его почту.',
      );
    }

    if (dto.applicationId && !application) {
      throw new NotFoundException('Заявка не найдена');
    }

    if (application?.tenantId) {
      throw new ConflictException('По этой заявке клуб уже заведён');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: { name, slug, cityId: city.id, publishedAt: null },
          select: { id: true, slug: true },
        });

        await tx.cancellationTier.createMany({ data: DEFAULT_TIERS.map((tier) => ({ tenantId: tenant.id, ...tier })) });

        // Руководитель — анкета клиента заводится всем, как при смене ролей:
        // сотрудник тоже записывается на мероприятия.
        await tx.tenantMembership.create({ data: { userId: owner.id, tenantId: tenant.id, roles: [Role.OWNER] } });
        await tx.clientProfile.create({ data: { userId: owner.id, tenantId: tenant.id } });

        if (application) {
          await tx.clubApplication.update({
            where: { id: application.id },
            data: { tenantId: tenant.id, status: 'CONNECTED' },
          });
        }

        return { slug: tenant.slug };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Клуб с таким кодом уже есть — выберите другой');
      }

      throw error;
    }
  }

  /** Открыт ли клуб и чего не хватает, чтобы открыть. */
  async opening(tenantId: string): Promise<ClubOpening> {
    const [tenant, halls] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { publishedAt: true } }),
      this.prisma.hall.findMany({
        where: { tenantId },
        select: { name: true, address: true, _count: { select: { tables: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      publishedAt: tenant.publishedAt?.toISOString() ?? null,
      problems: tenant.publishedAt
        ? []
        : openingProblems(halls.map((hall) => ({ name: hall.name, hasAddress: hall.address !== null, tables: hall._count.tables }))),
    };
  }

  /**
   * Открыть клуб — руководитель или владелец платформы. Пробные 7 дней
   * подписки — с этой минуты: пока клуб настраивался, срок не шёл.
   */
  async publish(tenantId: string): Promise<ClubOpening> {
    const state = await this.opening(tenantId);

    if (state.publishedAt) {
      throw new ConflictException('Клуб уже открыт');
    }

    if (state.problems.length > 0) {
      throw new BadRequestException(`Открыть пока нельзя: ${state.problems.join('; ')}`);
    }

    const now = new Date();
    const updated = await this.prisma.tenant.updateMany({ where: { id: tenantId, publishedAt: null }, data: { publishedAt: now } });

    if (updated.count === 0) {
      throw new ConflictException('Клуб уже открыт');
    }

    await this.billing.startTrial(tenantId, now);

    return this.opening(tenantId);
  }

  /** Владелец платформы: открыть или снова закрыть клуб (в черновик). */
  async setPublished(slug: string, published: boolean): Promise<ClubOpening> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug }, select: { id: true } });

    if (!tenant) {
      throw new NotFoundException('Клуб не найден');
    }

    if (published) {
      return this.publish(tenant.id);
    }

    await this.prisma.tenant.update({ where: { id: tenant.id }, data: { publishedAt: null } });

    return this.opening(tenant.id);
  }

  /** Владелец платформы — флагом учётки, как у новостей и подписок. */
  async assertPlatformOwner(userId: string): Promise<void> {
    const found = await this.prisma.user.findUnique({ where: { id: userId }, select: { platformRole: true, deactivatedAt: true } });

    if (found?.platformRole !== 'OWNER' || found.deactivatedAt) {
      throw new ForbiddenException('Клубы заводит только владелец платформы');
    }
  }
}
