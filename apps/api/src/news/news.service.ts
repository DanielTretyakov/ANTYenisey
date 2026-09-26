import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, type Prisma } from '@yenisey/database';
import type { NewsDraft, NewsFeed, NewsItem, NewsSection } from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';
import { pageSize, publishedAtAfter, visibleSections } from './news-rules';

const NEWS_SELECT = {
  id: true,
  section: true,
  title: true,
  body: true,
  publishedAt: true,
  updatedAt: true,
} as const satisfies Prisma.PlatformNewsSelect;

type Row = Prisma.PlatformNewsGetPayload<{ select: typeof NEWS_SELECT }>;

/**
 * Новости платформы (решение владельца от 26.09.2026).
 *
 * Читают все, без входа; раздел «Для клубов» — только сотрудники клубов и
 * владелец платформы (`visibleSections`). Пишет только владелец платформы —
 * проверка здесь, а не guard'ом ролей: роли клубные, а новость клуба не
 * имеет. В MAX новости не рассылаются.
 */
@Injectable()
export class NewsService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Чтение --------------------------------------------------------------

  async feed(
    viewerId: string | null,
    query: { section?: NewsSection; limit?: number; before?: string },
  ): Promise<NewsFeed> {
    const sections = await this.sectionsFor(viewerId);

    // Скрытый раздел — пустая лента, а не 403: гостю, открывшему ссылку на
    // «Для клубов», незачем объяснять, что там что-то есть.
    if (query.section && !sections.includes(query.section)) {
      return { items: [], sections };
    }

    const rows = await this.prisma.platformNews.findMany({
      where: {
        section: query.section ? query.section : { in: sections },
        publishedAt: query.before ? { not: null, lt: new Date(query.before) } : { not: null },
      },
      select: NEWS_SELECT,
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: pageSize(query.limit),
    });

    return { items: rows.map(toItem), sections };
  }

  /** Одна новость. Черновик и чужой раздел — 404, как несуществующая. */
  async findOne(viewerId: string | null, id: string): Promise<NewsItem> {
    const [row, sections] = await Promise.all([
      this.prisma.platformNews.findUnique({ where: { id }, select: NEWS_SELECT }),
      this.sectionsFor(viewerId),
    ]);

    if (!row || !row.publishedAt || !sections.includes(row.section)) {
      throw new NotFoundException('Новость не найдена');
    }

    return toItem(row);
  }

  // --- Редактор владельца платформы ---------------------------------------

  /** Все новости, черновики тоже, — для редактора. */
  async all(userId: string): Promise<NewsItem[]> {
    await this.assertOwner(userId);

    const rows = await this.prisma.platformNews.findMany({
      select: NEWS_SELECT,
      // Черновики — наверху: над ними и работают.
      orderBy: [{ publishedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      take: 200,
    });

    return rows.map(toItem);
  }

  async create(userId: string, draft: NewsDraft): Promise<NewsItem> {
    await this.assertOwner(userId);

    const row = await this.prisma.platformNews.create({
      data: {
        section: draft.section,
        title: draft.title,
        body: draft.body,
        publishedAt: publishedAtAfter(null, draft.published, new Date()),
        authorId: userId,
      },
      select: NEWS_SELECT,
    });

    return toItem(row);
  }

  async update(userId: string, id: string, draft: NewsDraft): Promise<NewsItem> {
    await this.assertOwner(userId);

    const current = await this.prisma.platformNews.findUnique({ where: { id }, select: { publishedAt: true } });

    if (!current) {
      throw new NotFoundException('Новость не найдена');
    }

    const row = await this.prisma.platformNews.update({
      where: { id },
      data: {
        section: draft.section,
        title: draft.title,
        body: draft.body,
        publishedAt: publishedAtAfter(current.publishedAt, draft.published, new Date()),
      },
      select: NEWS_SELECT,
    });

    return toItem(row);
  }

  /**
   * Удаление. Новость — не деньги и не история клиента: правило «удаления
   * нет» здесь ни от чего не защищает, а опубликованное по ошибке должно
   * уходить совсем.
   */
  async remove(userId: string, id: string): Promise<void> {
    await this.assertOwner(userId);

    const removed = await this.prisma.platformNews.deleteMany({ where: { id } });

    if (removed.count === 0) {
      throw new NotFoundException('Новость не найдена');
    }
  }

  // --- Внутреннее ----------------------------------------------------------

  private async sectionsFor(viewerId: string | null): Promise<NewsSection[]> {
    if (!viewerId) {
      return visibleSections({ staff: false, platformOwner: false });
    }

    const [user, staff] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: viewerId }, select: { platformRole: true, deactivatedAt: true } }),
      this.prisma.tenantMembership.count({
        where: {
          userId: viewerId,
          deactivatedAt: null,
          roles: { hasSome: [Role.ADMIN, Role.MANAGER, Role.OWNER, Role.COACH] },
        },
      }),
    ]);

    return visibleSections({
      staff: staff > 0 && !user?.deactivatedAt,
      platformOwner: user?.platformRole === 'OWNER' && !user.deactivatedAt,
    });
  }

  private async assertOwner(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { platformRole: true } });

    if (user?.platformRole !== 'OWNER') {
      throw new ForbiddenException('Новости платформы пишет только её владелец');
    }
  }
}

function toItem(row: Row): NewsItem {
  return {
    id: row.id,
    section: row.section,
    title: row.title,
    body: row.body,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
