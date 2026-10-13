import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, type Prisma } from '@yenisey/database';
import type { NewsDraft, NewsEmailInfo, NewsFeed, NewsItem, NewsSection } from '@yenisey/types';
import { newsRecipients, normalizeEmail, type NewsRecipient } from '../mail/mail-rules';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { pageSize, publishedAtAfter, visibleSections } from './news-rules';

const NEWS_SELECT = {
  id: true,
  section: true,
  title: true,
  body: true,
  publishedAt: true,
  updatedAt: true,
  emailedAt: true,
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

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

  // --- Рассылка письмом (12.10.2026) --------------------------------------

  /** Сколько получат новость письмом — до нажатия «Отправить». */
  async emailInfo(userId: string, id: string): Promise<NewsEmailInfo> {
    await this.assertOwner(userId);

    const news = await this.prisma.platformNews.findUnique({ where: { id }, select: { section: true, emailedAt: true } });

    if (!news) throw new NotFoundException('Новость не найдена');

    return { recipients: (await this.recipients(news.section)).length, emailedAt: news.emailedAt?.toISOString() ?? null };
  }

  /**
   * Разослать опубликованную новость письмом — один раз: отметка ставится
   * условным обновлением, и второе нажатие (или второй владелец) получит 409.
   */
  async email(userId: string, id: string): Promise<NewsEmailInfo> {
    await this.assertOwner(userId);

    if (!this.mail.enabled) {
      throw new ConflictException('Почта сервиса пока не подключена');
    }

    const news = await this.prisma.platformNews.findUnique({ where: { id }, select: NEWS_SELECT });

    if (!news) throw new NotFoundException('Новость не найдена');
    if (!news.publishedAt) throw new BadRequestException('Сначала опубликуйте новость');

    const now = new Date();
    const recipients = await this.recipients(news.section);

    await this.prisma.$transaction(async (tx) => {
      const marked = await tx.platformNews.updateMany({ where: { id, emailedAt: null }, data: { emailedAt: now } });

      if (marked.count === 0) throw new ConflictException('Эта новость уже разослана');

      await this.mail.enqueue(
        tx,
        recipients.map((recipient) => ({
          to: recipient.to,
          userId: recipient.userId,
          template: 'NEWS' as const,
          payload: { newsId: news.id, title: news.title, body: news.body, section: news.section },
          dedupeKey: `news:${news.id}`,
        })),
      );
    });

    return { recipients: recipients.length, emailedAt: now.toISOString() };
  }

  /**
   * Кому уходит рассылка: учётки с согласием и подтверждённой почтой; раздел
   * «Для клубов» — только сотрудники клубов (как `visibleSections`) и
   * заявители с галочкой «новости для клубов». Письма клубам-кандидатам — только
   * тем, кто сам согласился.
   */
  private async recipients(section: NewsSection): Promise<NewsRecipient[]> {
    const forClubs = section === 'CLUBS';
    const [users, applicants] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          newsEmailConsentAt: { not: null },
          emailVerifiedAt: { not: null },
          deactivatedAt: null,
          anonymizedAt: null,
          ...(forClubs
            ? { memberships: { some: { deactivatedAt: null, roles: { hasSome: [Role.ADMIN, Role.MANAGER, Role.OWNER, Role.COACH] } } } }
            : {}),
        },
        select: { id: true, email: true },
      }),
      forClubs
        ? this.prisma.clubApplication.findMany({
            where: { newsConsentAt: { not: null }, email: { not: null } },
            select: { email: true },
          })
        : Promise.resolve([] as { email: string | null }[]),
    ]);
    const emails = [...users.map((user) => user.email), ...applicants.map((row) => row.email!)].map(normalizeEmail);
    const suppressed = await this.prisma.emailSuppression.findMany({ where: { email: { in: emails } }, select: { email: true } });

    return newsRecipients({
      users,
      applicants: applicants.map((row) => ({ email: row.email! })),
      suppressed: new Set(suppressed.map((row) => row.email)),
    });
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
    emailedAt: row.emailedAt?.toISOString() ?? null,
  };
}
