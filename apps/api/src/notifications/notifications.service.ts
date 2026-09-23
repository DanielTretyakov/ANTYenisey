import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import {
  NotificationChannel,
  type NotificationCategory,
  type NotificationType,
  type Prisma,
} from '@yenisey/database';
import type { NotificationCategoryName, NotificationSettingsView } from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';
import { MaxTransport } from './max.transport';
import { availableCategories, CATEGORY_OF, categoryEnabled, isToggleableCategory } from './notification-rules';

// Правила повторяют перечисления схемы строками — здесь компилятор следит,
// чтобы они не разошлись: новый тип в схеме без категории не соберётся.
const CATEGORIES: Record<NotificationType, NotificationCategory> = CATEGORY_OF;

/** Черновик уведомления: кому, о чём и с каким ключом идемпотентности. */
export interface NotificationDraft {
  userId: string;
  /** Клуб, о котором сообщение. У сводки платформы — пусто. */
  tenantId?: string | null;
  type: NotificationType;
  payload?: Prisma.InputJsonValue;
  /** Уникален в паре с адресатом: второй такой же черновик не встанет. */
  dedupeKey: string;
  /** Раньше не слать: тихие часы, напоминание к сроку. */
  sendAfter?: Date;
}

type Db = Prisma.TransactionClient | PrismaService;

/**
 * Очередь уведомлений: единственный писатель строк Notification.
 *
 * Код предметной области зовёт `enqueue` внутри своей транзакции и дальше о
 * доставке не думает: откатилась транзакция — нет и сообщения, лёг MAX —
 * сообщение уйдёт позже (NotificationDispatcher).
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transport: MaxTransport,
  ) {}

  /**
   * Поставить уведомления в очередь. Возвращает, сколько строк встало.
   *
   * Строка заводится только тому, кому есть куда слать: без привязки MAX, с
   * остановленным ботом или выключенной категорией её нет вовсе — копить
   * недоставляемое незачем. Повтор с тем же ключом молча пропускается.
   */
  async enqueue(db: Db, drafts: NotificationDraft[]): Promise<number> {
    if (drafts.length === 0) {
      return 0;
    }

    const userIds = [...new Set(drafts.map((draft) => draft.userId))];

    const [links, disabled] = await Promise.all([
      db.maxLink.findMany({ where: { userId: { in: userIds }, blockedAt: null }, select: { userId: true } }),
      db.notificationSetting.findMany({
        where: { userId: { in: userIds }, enabled: false },
        select: { userId: true, category: true },
      }),
    ]);

    const reachable = new Set(links.map((link) => link.userId));
    const off = new Map<string, Set<string>>();

    for (const setting of disabled) {
      const set = off.get(setting.userId) ?? new Set<string>();
      set.add(setting.category);
      off.set(setting.userId, set);
    }

    const rows = drafts
      .filter(
        (draft) =>
          reachable.has(draft.userId) &&
          categoryEnabled(CATEGORIES[draft.type], off.get(draft.userId) ?? new Set()),
      )
      .map((draft) => ({
        userId: draft.userId,
        tenantId: draft.tenantId ?? null,
        channel: NotificationChannel.MAX,
        type: draft.type,
        payload: draft.payload,
        dedupeKey: draft.dedupeKey,
        sendAfter: draft.sendAfter,
      }));

    if (rows.length === 0) {
      return 0;
    }

    const created = await db.notification.createMany({ data: rows, skipDuplicates: true });

    return created.count;
  }

  /** Настройки уведомлений человека: привязка и категории по его ролям. */
  async settings(userId: string): Promise<NotificationSettingsView> {
    const [user, link, memberships, stored] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { platformRole: true } }),
      this.prisma.maxLink.findUnique({ where: { userId }, select: { linkedAt: true, blockedAt: true } }),
      this.prisma.tenantMembership.findMany({ where: { userId, deactivatedAt: null }, select: { role: true } }),
      this.prisma.notificationSetting.findMany({ where: { userId }, select: { category: true, enabled: true } }),
    ]);

    const categories = availableCategories({
      clubRoles: memberships.map((membership) => membership.role),
      platformOwner: user.platformRole === 'OWNER',
    });
    const off = new Set(stored.filter((row) => !row.enabled).map((row) => row.category));

    return {
      max: {
        available: this.transport.mode !== 'off',
        linked: link !== null,
        linkedAt: link?.linkedAt.toISOString() ?? null,
        blocked: link?.blockedAt != null,
      },
      categories: categories.map((category) => ({
        category: category satisfies NotificationCategoryName,
        enabled: categoryEnabled(category, off),
      })),
    };
  }

  /** Включить или выключить категорию. Чужую по ролям — 400. */
  async setCategory(userId: string, category: string, enabled: boolean): Promise<NotificationSettingsView> {
    const view = await this.settings(userId);

    if (!isToggleableCategory(category) || !view.categories.some((item) => item.category === category)) {
      throw new BadRequestException('Такой категории уведомлений у вас нет');
    }

    await this.prisma.notificationSetting.upsert({
      where: { userId_category: { userId, category } },
      update: { enabled },
      create: { userId, category, enabled },
    });

    return this.settings(userId);
  }

  /**
   * Проверочное сообщение. Не чаще раза в минуту: ключ — текущая минута, и
   * второе нажатие в ту же минуту упирается в уникальность, а не в счётчик.
   */
  async sendTest(userId: string, now = new Date()): Promise<void> {
    const link = await this.prisma.maxLink.findUnique({ where: { userId }, select: { blockedAt: true } });

    if (!link) {
      throw new ConflictException('Сначала подключите MAX');
    }

    if (link.blockedAt) {
      throw new ConflictException('Бот остановлен в MAX — запустите его снова, и сообщения пойдут');
    }

    const minute = now.toISOString().slice(0, 16);
    const queued = await this.enqueue(this.prisma, [{ userId, type: 'TEST', dedupeKey: `test:${minute}` }]);

    if (queued === 0) {
      throw new HttpException('Проверочное сообщение уже отправлено — подождите минуту', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
