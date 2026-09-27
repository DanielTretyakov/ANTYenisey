import { Injectable, NotFoundException } from '@nestjs/common';
import { Role, type Prisma } from '@yenisey/database';
import type { ClubPost, ClubPostPage, ClubPostRequest, ClubPostWithClub } from '@yenisey/types';
import { shortName } from '@yenisey/types';
import { publishedAtAfter } from '../news/news-rules';
import { clubTimezone, zoneClock } from '../notifications/clock';
import { sendAfterFor } from '../notifications/notification-rules';
import { NotificationsService, type NotificationDraft } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { announceOnSave, excerptOf } from './post-rules';

const POST_SELECT = {
  id: true,
  title: true,
  body: true,
  publishedAt: true,
  updatedAt: true,
  author: { select: { user: { select: { fullName: true } } } },
} as const satisfies Prisma.ClubPostSelect;

type Row = Prisma.ClubPostGetPayload<{ select: typeof POST_SELECT }>;

/** Сколько публикаций за раз: лента клуба и «из моих клубов» на стартовой. */
const PAGE_DEFAULT = 20;
const PAGE_MAX = 50;

/** Сколько черновиков ставится в очередь одним запросом. */
const ENQUEUE_CHUNK = 500;

/**
 * Лента клуба: акции и объявления (решение владельца от 26.09.2026).
 *
 * Пишут руководитель, управляющий и администратор — любой из них правит
 * любую публикацию клуба: лента принадлежит клубу, автор — подпись. Читают
 * все без входа. Опубликованное впервые уходит сообщением клиентам клуба
 * (категория CLUB_NEWS, выключаемая), в тихие часы — к 08:00 по поясу клуба.
 *
 * Удаление есть, как у новостей платформы: публикация — не деньги и не
 * история клиента, и акция, выложенная по ошибке, должна уходить совсем.
 */
@Injectable()
export class ClubPostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // --- Чтение --------------------------------------------------------------

  /** Опубликованное — свежие сверху. */
  async feed(tenantId: string, query: { limit?: number; offset?: number }): Promise<ClubPostPage> {
    const where = { tenantId, publishedAt: { not: null } };
    const [total, rows] = await Promise.all([
      this.prisma.clubPost.count({ where }),
      this.prisma.clubPost.findMany({
        where,
        select: POST_SELECT,
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        take: pageSize(query.limit),
        skip: query.offset ?? 0,
      }),
    ]);

    return { total, items: rows.map(toPost) };
  }

  /** Одна публикация. Черновик — 404, как несуществующая. */
  async findOne(tenantId: string, id: string): Promise<ClubPost> {
    const row = await this.prisma.clubPost.findFirst({
      where: { id, tenantId, publishedAt: { not: null } },
      select: POST_SELECT,
    });

    if (!row) {
      throw new NotFoundException('Публикация не найдена');
    }

    return toPost(row);
  }

  /**
   * «Из моих клубов» на стартовой: клубы, отмеченные своими, и те, где
   * человек клиент, — как у предложения абонементов.
   */
  async mine(userId: string, limit?: number): Promise<ClubPostWithClub[]> {
    const rows = await this.prisma.clubPost.findMany({
      where: {
        publishedAt: { not: null },
        tenant: {
          OR: [
            { favouritedBy: { some: { userId } } },
            { memberships: { some: { userId, deactivatedAt: null } } },
          ],
        },
      },
      select: { ...POST_SELECT, tenant: { select: { slug: true, name: true, accentColor: true } } },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: pageSize(limit),
    });

    return rows.map((row) => ({ ...toPost(row), club: row.tenant }));
  }

  // --- Редактор сотрудников клуба -----------------------------------------

  /** Всё, черновики тоже, — черновики сверху: над ними и работают. */
  async all(tenantId: string): Promise<ClubPost[]> {
    const rows = await this.prisma.clubPost.findMany({
      where: { tenantId },
      select: POST_SELECT,
      orderBy: [{ publishedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      take: 200,
    });

    return rows.map(toPost);
  }

  async create(tenantId: string, authorId: string, draft: ClubPostRequest): Promise<ClubPost> {
    const publishedAt = publishedAtAfter(null, draft.published, new Date());

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.clubPost.create({
        data: { tenantId, authorId, title: draft.title, body: draft.body, publishedAt },
        select: POST_SELECT,
      });

      if (announceOnSave(null, publishedAt)) {
        await this.announce(tx, tenantId, authorId, row);
      }

      return toPost(row);
    });
  }

  async update(tenantId: string, actorId: string, id: string, draft: ClubPostRequest): Promise<ClubPost> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.clubPost.findFirst({ where: { id, tenantId }, select: { publishedAt: true } });

      if (!current) {
        throw new NotFoundException('Публикация не найдена');
      }

      const publishedAt = publishedAtAfter(current.publishedAt, draft.published, new Date());
      const row = await tx.clubPost.update({
        where: { id },
        data: { title: draft.title, body: draft.body, publishedAt },
        select: POST_SELECT,
      });

      if (announceOnSave(current.publishedAt, publishedAt)) {
        await this.announce(tx, tenantId, actorId, row);
      }

      return toPost(row);
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const removed = await this.prisma.clubPost.deleteMany({ where: { id, tenantId } });

    if (removed.count === 0) {
      throw new NotFoundException('Публикация не найдена');
    }
  }

  /**
   * Сообщение клиентам клуба — той же транзакцией, что публикует: откатилась
   * публикация — нет и сообщения. Кому доставить некуда (нет MAX и браузера,
   * категория выключена), строки не будет — это решает `enqueue`.
   */
  private async announce(tx: Prisma.TransactionClient, tenantId: string, actorId: string, row: Row): Promise<void> {
    const [tenant, clients, timezone] = await Promise.all([
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, slug: true } }),
      tx.tenantMembership.findMany({
        where: {
          tenantId,
          roles: { has: Role.CLIENT },
          deactivatedAt: null,
          userId: { not: actorId },
          user: { deactivatedAt: null, anonymizedAt: null },
        },
        select: { userId: true },
      }),
      clubTimezone(tx, tenantId),
    ]);

    const sendAfter = sendAfterFor(new Date(), zoneClock(timezone), false);
    const drafts: NotificationDraft[] = clients.map((client) => ({
      userId: client.userId,
      tenantId,
      type: 'CLUB_POST',
      payload: { club: tenant.name, slug: tenant.slug, title: row.title, excerpt: excerptOf(row.body) },
      dedupeKey: `club-post:${row.id}`,
      sendAfter,
    }));

    for (let index = 0; index < drafts.length; index += ENQUEUE_CHUNK) {
      await this.notifications.enqueue(tx, drafts.slice(index, index + ENQUEUE_CHUNK));
    }
  }
}

function toPost(row: Row): ClubPost {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    author: shortName(row.author.user.fullName),
  };
}

function pageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isInteger(requested) || requested < 1) {
    return PAGE_DEFAULT;
  }

  return Math.min(requested, PAGE_MAX);
}
