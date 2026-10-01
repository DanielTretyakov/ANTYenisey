import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, type Prisma } from '@yenisey/database';
import type {
  ClubPost,
  ClubPostPage,
  ClubPostRequest,
  ClubPostsUnread,
  ClubPostWithClub,
} from '@yenisey/types';
import { readWorkingHours, shortName } from '@yenisey/types';
import { publishedAtAfter } from '../news/news-rules';
import { clubTimezone, zoneClock } from '../notifications/clock';
import { sendAfterFor } from '../notifications/notification-rules';
import { NotificationsService, type NotificationDraft } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { announceOnSave, excerptOf, isUnread, unreadSince } from './post-rules';
import { defaultWelcome, type WelcomeClub } from './welcome-rules';

const POST_SELECT = {
  id: true,
  title: true,
  body: true,
  publishedAt: true,
  updatedAt: true,
  welcome: true,
  autoBody: true,
  author: { select: { user: { select: { fullName: true } } } },
  tenant: { select: { name: true } },
} as const satisfies Prisma.ClubPostSelect;

type Row = Prisma.ClubPostGetPayload<{ select: typeof POST_SELECT }>;

/** Сколько публикаций за раз: лента клуба и «из моих клубов» на стартовой. */
const PAGE_DEFAULT = 20;
const PAGE_MAX = 50;

/** Сколько черновиков ставится в очередь одним запросом. */
const ENQUEUE_CHUNK = 500;

/** Клубы «мои» для человека: отмеченные своими и где он состоит. */
function myClubsWhere(userId: string): Prisma.TenantWhereInput {
  return {
    OR: [{ favouritedBy: { some: { userId } } }, { memberships: { some: { userId, deactivatedAt: null } } }],
  };
}

/** Что горит непрочитанным: опубликовано, не открыто, свежее окна (приветствие — всегда). */
function unreadWhere(userId: string, now: Date): Prisma.ClubPostWhereInput {
  return {
    publishedAt: { not: null },
    reads: { none: { userId } },
    OR: [{ welcome: true }, { publishedAt: { gte: unreadSince(now) } }],
  };
}

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
 *
 * Приветствие клуба (решение от 30.09.2026) — та же публикация с флагом
 * `welcome`: закреплено над лентой, есть у каждого клуба (заводит миграция,
 * сид и, на всякий случай, первое чтение ленты), не удаляется и сообщением
 * не рассылается. Пока `autoBody`, заголовок и текст собираются из данных
 * клуба при каждом чтении (`defaultWelcome`) — и сами следуют за настройками.
 */
@Injectable()
export class ClubPostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // --- Чтение --------------------------------------------------------------

  /** Опубликованное — свежие сверху; приветствие — отдельно, закреплённым. */
  async feed(
    tenantId: string,
    viewerId: string | null,
    query: { limit?: number; offset?: number },
  ): Promise<ClubPostPage> {
    const where = { tenantId, publishedAt: { not: null }, welcome: false };
    const now = new Date();

    let pinnedRow = await this.prisma.clubPost.findFirst({ where: { tenantId, welcome: true }, select: POST_SELECT });

    if (!pinnedRow) {
      await this.ensureWelcome(tenantId);
      pinnedRow = await this.prisma.clubPost.findFirst({ where: { tenantId, welcome: true }, select: POST_SELECT });
    }

    const [total, rows, unreadCount] = await Promise.all([
      this.prisma.clubPost.count({ where }),
      this.prisma.clubPost.findMany({
        where,
        select: POST_SELECT,
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        take: pageSize(query.limit),
        skip: query.offset ?? 0,
      }),
      viewerId ? this.prisma.clubPost.count({ where: { tenantId, ...unreadWhere(viewerId, now) } }) : 0,
    ]);

    const pinned = pinnedRow?.publishedAt ? pinnedRow : null;
    const read = await this.readIds(viewerId, [...rows, ...(pinned ? [pinned] : [])]);
    const welcome = pinned?.autoBody ? defaultWelcome(await this.welcomeInput(tenantId)) : null;

    return {
      pinned: pinned ? toPost(withWelcome(pinned, welcome), read, viewerId, now) : null,
      items: rows.map((row) => toPost(row, read, viewerId, now)),
      total,
      unreadCount,
    };
  }

  /** Одна публикация. Черновик — 404, как несуществующая. */
  async findOne(tenantId: string, id: string, viewerId: string | null): Promise<ClubPost> {
    const row = await this.prisma.clubPost.findFirst({
      where: { id, tenantId, publishedAt: { not: null } },
      select: POST_SELECT,
    });

    if (!row) {
      throw new NotFoundException('Публикация не найдена');
    }

    const welcome = row.autoBody ? defaultWelcome(await this.welcomeInput(tenantId)) : null;

    return toPost(withWelcome(row, welcome), await this.readIds(viewerId, [row]), viewerId, new Date());
  }

  /**
   * «Из моих клубов» на стартовой: клубы, отмеченные своими, и те, где
   * человек клиент, — как у предложения абонементов. Приветствий здесь нет:
   * это лента новостей, а приветствие ждёт на странице клуба.
   */
  async mine(userId: string, limit?: number): Promise<ClubPostWithClub[]> {
    const rows = await this.prisma.clubPost.findMany({
      where: { publishedAt: { not: null }, welcome: false, tenant: myClubsWhere(userId) },
      select: { ...POST_SELECT, tenant: { select: { slug: true, name: true, accentColor: true } } },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: pageSize(limit),
    });

    const read = await this.readIds(userId, rows);
    const now = new Date();

    return rows.map((row) => ({ ...toPost(row, read, userId, now), club: row.tenant }));
  }

  /** Непрочитанное по «моим клубам» — шапка и карточки на стартовой. */
  async unread(userId: string): Promise<ClubPostsUnread> {
    const groups = await this.prisma.clubPost.groupBy({
      by: ['tenantId'],
      where: { ...unreadWhere(userId, new Date()), tenant: myClubsWhere(userId) },
      _count: { _all: true },
    });

    if (groups.length === 0) {
      return { total: 0, clubs: [] };
    }

    const tenants = await this.prisma.tenant.findMany({
      where: { id: { in: groups.map((group) => group.tenantId) } },
      select: { id: true, slug: true, name: true, accentColor: true },
      orderBy: { name: 'asc' },
    });
    const counts = new Map(groups.map((group) => [group.tenantId, group._count._all]));
    const clubs = tenants.map(({ id, ...club }) => ({ ...club, unread: counts.get(id) ?? 0 }));

    return { total: clubs.reduce((sum, club) => sum + club.unread, 0), clubs };
  }

  /**
   * Отметить прочитанным то, что человек увидел в окне новостей. Только
   * опубликованное этого клуба; повтор ничего не меняет.
   */
  async markRead(tenantId: string, userId: string, ids: string[]): Promise<void> {
    const posts = await this.prisma.clubPost.findMany({
      where: { id: { in: ids }, tenantId, publishedAt: { not: null } },
      select: { id: true },
    });

    if (posts.length > 0) {
      await this.prisma.clubPostRead.createMany({
        data: posts.map((post) => ({ userId, postId: post.id })),
        skipDuplicates: true,
      });
    }
  }

  // --- Редактор сотрудников клуба -----------------------------------------

  /** Всё, черновики тоже: приветствие первым, дальше черновики — над ними и работают. */
  async all(tenantId: string): Promise<ClubPost[]> {
    await this.ensureWelcome(tenantId);

    const rows = await this.prisma.clubPost.findMany({
      where: { tenantId },
      select: POST_SELECT,
      orderBy: [{ welcome: 'desc' }, { publishedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      take: 200,
    });

    const auto = rows.some((row) => row.autoBody) ? defaultWelcome(await this.welcomeInput(tenantId)) : null;
    const now = new Date();

    return rows.map((row) => toPost(withWelcome(row, row.autoBody ? auto : null), new Set(), null, now));
  }

  /** Текст приветствия по умолчанию — для предпросмотра и «Вернуть исходный». */
  async welcomeDefault(tenantId: string): Promise<{ title: string; body: string }> {
    return defaultWelcome(await this.welcomeInput(tenantId));
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

      return toPost(row, new Set(), null, new Date());
    });
  }

  async update(tenantId: string, actorId: string, id: string, draft: ClubPostRequest): Promise<ClubPost> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.clubPost.findFirst({
        where: { id, tenantId },
        select: { publishedAt: true, welcome: true },
      });

      if (!current) {
        throw new NotFoundException('Публикация не найдена');
      }

      const publishedAt = publishedAtAfter(current.publishedAt, draft.published, new Date());

      if (current.welcome) {
        // Приветствие: «собирать из данных клуба» — снимок текста по
        // умолчанию, свой текст — как у обычной публикации. Сообщения нет:
        // приветствие — не новость, его рассылка ушла бы всему клубу разом.
        const auto = draft.auto ?? false;
        const text = auto ? defaultWelcome(await this.welcomeInput(tenantId, tx)) : draft;

        return tx.clubPost.update({
          where: { id },
          data: { title: text.title, body: text.body, publishedAt, autoBody: auto },
          select: POST_SELECT,
        });
      }

      const row = await tx.clubPost.update({
        where: { id },
        data: { title: draft.title, body: draft.body, publishedAt },
        select: POST_SELECT,
      });

      if (announceOnSave(current.publishedAt, publishedAt)) {
        await this.announce(tx, tenantId, actorId, row);
      }

      return row;
    });

    return toPost(updated, new Set(), null, new Date());
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const post = await this.prisma.clubPost.findFirst({ where: { id, tenantId }, select: { welcome: true } });

    if (!post) {
      throw new NotFoundException('Публикация не найдена');
    }

    if (post.welcome) {
      throw new ConflictException('Приветствие клуба можно скрыть в черновики, но не удалить');
    }

    await this.prisma.clubPost.deleteMany({ where: { id, tenantId, welcome: false } });
  }

  /**
   * Приветствие клуба, если его нет, — собранным текстом. Уникальный индекс
   * `ClubPost_one_welcome` делает повтор и гонку двух запросов безвредными.
   */
  async ensureWelcome(tenantId: string): Promise<void> {
    const text = defaultWelcome(await this.welcomeInput(tenantId));

    await this.prisma.clubPost.createMany({
      data: [{ tenantId, title: text.title, body: text.body, welcome: true, autoBody: true, publishedAt: new Date() }],
      skipDuplicates: true,
    });
  }

  /** Данные клуба для приветствия: залы по старшинству, контакты, тренеры, абонементы. */
  private async welcomeInput(
    tenantId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<WelcomeClub> {
    const [tenant, coaches, plans] = await Promise.all([
      client.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: {
          name: true,
          phone: true,
          email: true,
          vkUrl: true,
          maxUrl: true,
          halls: {
            select: {
              name: true,
              address: true,
              phone: true,
              tableHourPrice: true,
              workingHours: true,
              city: { select: { name: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      client.tenantMembership.count({
        where: { tenantId, roles: { has: Role.COACH }, deactivatedAt: null },
      }),
      client.subscriptionPlan.count({ where: { tenantId, isActive: true } }),
    ]);

    return {
      name: tenant.name,
      phone: tenant.phone,
      email: tenant.email,
      vkUrl: tenant.vkUrl,
      maxUrl: tenant.maxUrl,
      hasCoaches: coaches > 0,
      hasPlans: plans > 0,
      halls: tenant.halls.map((hall) => ({
        name: hall.name,
        city: hall.city?.name ?? null,
        address: hall.address,
        phone: hall.phone,
        tableHourPrice: hall.tableHourPrice,
        workingHours: readWorkingHours(hall.workingHours),
      })),
    };
  }

  /** Что из показанного человек уже открывал. */
  private async readIds(viewerId: string | null, rows: { id: string }[]): Promise<Set<string>> {
    if (!viewerId || rows.length === 0) {
      return new Set();
    }

    const reads = await this.prisma.clubPostRead.findMany({
      where: { userId: viewerId, postId: { in: rows.map((row) => row.id) } },
      select: { postId: true },
    });

    return new Set(reads.map((read) => read.postId));
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

/** Собранный текст приветствия — вместо снимка в строке. */
function withWelcome<T extends Row>(row: T, text: { title: string; body: string } | null): T {
  return text ? { ...row, title: text.title, body: text.body } : row;
}

function toPost(row: Row, read: Set<string>, viewerId: string | null, now: Date): ClubPost {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    author: row.author ? shortName(row.author.user.fullName) : row.tenant.name,
    welcome: row.welcome,
    autoBody: row.autoBody,
    unread: viewerId !== null && isUnread(row, read.has(row.id), now),
  };
}

function pageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isInteger(requested) || requested < 1) {
    return PAGE_DEFAULT;
  }

  return Math.min(requested, PAGE_MAX);
}
