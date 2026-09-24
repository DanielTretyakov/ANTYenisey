import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
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
import { PushTransport } from './push.transport';

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
  /** Уникален в паре с адресатом и каналом: второй такой же черновик не встанет. */
  dedupeKey: string;
  /** Раньше не слать: тихие часы, напоминание к сроку. */
  sendAfter?: Date;
}

/** Подписка браузера — в том виде, в каком её отдаёт PushSubscription.toJSON(). */
export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
}

type Db = Prisma.TransactionClient | PrismaService;

/**
 * Кому вообще есть куда слать: привязан MAX (бот не остановлен) или есть хоть
 * одна подписка браузера. Планировщик по этому списку решает, на кого
 * смотреть, — остальным строка всё равно не встала бы.
 */
export async function reachableUserIds(db: Db): Promise<string[]> {
  const [links, subscriptions] = await Promise.all([
    db.maxLink.findMany({ where: { blockedAt: null }, select: { userId: true } }),
    db.pushSubscription.findMany({ select: { userId: true }, distinct: ['userId'] }),
  ]);

  return [...new Set([...links, ...subscriptions].map((row) => row.userId))];
}

/**
 * Очередь уведомлений: единственный писатель строк Notification.
 *
 * Код предметной области зовёт `enqueue` внутри своей транзакции и дальше о
 * доставке не думает: откатилась транзакция — нет и сообщения, лёг MAX или
 * служба push — сообщение уйдёт позже (NotificationDispatcher).
 *
 * Каналов два — MAX и браузер. Сообщение встаёт в каждый, куда человеку есть
 * куда доставить: подключил оба — получит в оба. Что присылать, решают
 * категории, и они одни на все каналы.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly max: MaxTransport,
    private readonly push: PushTransport,
  ) {}

  /**
   * Поставить уведомления в очередь. Возвращает, сколько строк встало.
   *
   * Строка заводится только в канал, куда есть куда слать: без привязки MAX,
   * с остановленным ботом, без подписки браузера или с выключенной категорией
   * её нет вовсе — копить недоставляемое незачем. Повтор с тем же ключом молча
   * пропускается.
   */
  async enqueue(db: Db, drafts: NotificationDraft[]): Promise<number> {
    if (drafts.length === 0) {
      return 0;
    }

    const userIds = [...new Set(drafts.map((draft) => draft.userId))];

    const [links, subscriptions, disabled] = await Promise.all([
      db.maxLink.findMany({ where: { userId: { in: userIds }, blockedAt: null }, select: { userId: true } }),
      this.push.mode === 'off'
        ? Promise.resolve([])
        : db.pushSubscription.findMany({ where: { userId: { in: userIds } }, select: { userId: true }, distinct: ['userId'] }),
      db.notificationSetting.findMany({
        where: { userId: { in: userIds }, enabled: false },
        select: { userId: true, category: true },
      }),
    ]);

    const viaMax = new Set(links.map((link) => link.userId));
    const viaPush = new Set(subscriptions.map((row) => row.userId));
    const off = new Map<string, Set<string>>();

    for (const setting of disabled) {
      const set = off.get(setting.userId) ?? new Set<string>();
      set.add(setting.category);
      off.set(setting.userId, set);
    }

    const rows = drafts
      .filter((draft) => categoryEnabled(CATEGORIES[draft.type], off.get(draft.userId) ?? new Set()))
      .flatMap((draft) =>
        [
          viaMax.has(draft.userId) ? NotificationChannel.MAX : null,
          viaPush.has(draft.userId) ? NotificationChannel.WEB_PUSH : null,
        ]
          .filter((channel): channel is NotificationChannel => channel !== null)
          .map((channel) => ({
            userId: draft.userId,
            tenantId: draft.tenantId ?? null,
            channel,
            type: draft.type,
            payload: draft.payload,
            dedupeKey: draft.dedupeKey,
            sendAfter: draft.sendAfter,
          })),
      );

    if (rows.length === 0) {
      return 0;
    }

    const created = await db.notification.createMany({ data: rows, skipDuplicates: true });

    return created.count;
  }

  /** Настройки уведомлений человека: каналы и категории по его ролям. */
  async settings(userId: string): Promise<NotificationSettingsView> {
    const [user, link, devices, memberships, stored] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { platformRole: true } }),
      this.prisma.maxLink.findUnique({ where: { userId }, select: { linkedAt: true, blockedAt: true } }),
      this.prisma.pushSubscription.count({ where: { userId } }),
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
        available: this.max.mode !== 'off',
        linked: link !== null,
        linkedAt: link?.linkedAt.toISOString() ?? null,
        blocked: link?.blockedAt != null,
      },
      push: {
        available: this.push.mode !== 'off',
        publicKey: this.push.publicKey,
        devices,
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
   * Подписать это устройство на уведомления в браузере.
   *
   * Подписка с тем же адресом переходит к вошедшему: браузер один, и на
   * общем компьютере уведомления должны идти тому, кто за ним сейчас, а не
   * тому, кто подписался первым.
   */
  async subscribe(userId: string, subscription: BrowserSubscription): Promise<NotificationSettingsView> {
    if (this.push.mode === 'off') {
      throw new ServiceUnavailableException('Уведомления в браузере пока не подключены');
    }

    const fields = {
      userId,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent: subscription.userAgent?.slice(0, 300) ?? null,
    };

    await this.prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      update: fields,
      create: { endpoint: subscription.endpoint, ...fields },
    });

    return this.settings(userId);
  }

  /** Отписать устройство. Только своё: чужую подписку по адресу не снять. */
  async unsubscribe(userId: string, endpoint: string): Promise<NotificationSettingsView> {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });

    return this.settings(userId);
  }

  /**
   * Проверочное сообщение — во все подключённые каналы. Не чаще раза в
   * минуту: ключ — текущая минута, и второе нажатие в ту же минуту упирается
   * в уникальность, а не в счётчик.
   */
  async sendTest(userId: string, now = new Date()): Promise<void> {
    const [link, devices] = await Promise.all([
      this.prisma.maxLink.findUnique({ where: { userId }, select: { blockedAt: true } }),
      this.push.mode === 'off' ? Promise.resolve(0) : this.prisma.pushSubscription.count({ where: { userId } }),
    ]);

    if (!link && devices === 0) {
      throw new ConflictException('Сначала подключите MAX или уведомления в браузере');
    }

    if (link?.blockedAt && devices === 0) {
      throw new ConflictException('Бот остановлен в MAX — запустите его снова, и сообщения пойдут');
    }

    const minute = now.toISOString().slice(0, 16);
    const queued = await this.enqueue(this.prisma, [{ userId, type: 'TEST', dedupeKey: `test:${minute}` }]);

    if (queued === 0) {
      throw new HttpException('Проверочное сообщение уже отправлено — подождите минуту', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
