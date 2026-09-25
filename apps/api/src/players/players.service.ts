import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SportRankStatus, StoredFileKind } from '@yenisey/database';
import type {
  PlayerAchievement,
  PlayerProfile,
  PlayerRank,
  PublicPlayer,
  SportRankLevel,
} from '@yenisey/types';
import { shortName } from '@yenisey/types';
import { formatBirthDate, parsePastDate } from '../auth/birth-date';
import { FileIntake } from '../files/file-intake.service';
import { FileStorage } from '../files/file-storage';
import { PrismaService } from '../prisma/prisma.service';
import { StaffNotifier } from '../notifications/staff-notifier.service';
import type { AchievementDto, SetRankDto, UpdateEquipmentDto } from './dto/player.dto';
import { PlayerAccess } from './player-access.service';
import { canSeeProfile, cleanText, decideRankEdit, isProfilePublic, type RankState } from './player-rules';

/**
 * Больше достижений человеку не нужно, а список без потолка — место, куда
 * можно складывать что угодно в любом количестве.
 */
const MAX_ACHIEVEMENTS = 100;

/** Разряд вместе с тем, кто его проверил, — одним запросом. */
export const RANK_SELECT = {
  rank: true,
  orderNumber: true,
  orderDate: true,
  documentFileId: true,
  status: true,
  rejectionReason: true,
  reviewedAt: true,
  updatedAt: true,
  document: { select: { id: true, contentType: true, size: true } },
  reviewedBy: {
    select: {
      user: { select: { fullName: true } },
      tenant: { select: { name: true, slug: true } },
    },
  },
} satisfies Prisma.SportRankSelect;

type RankRow = Prisma.SportRankGetPayload<{ select: typeof RANK_SELECT }>;

const ACHIEVEMENT_SELECT = {
  id: true,
  title: true,
  date: true,
  level: true,
  place: true,
  note: true,
} satisfies Prisma.AchievementSelect;

const PROFILE_SELECT = {
  id: true,
  fullName: true,
  birthDate: true,
  playerProfile: { select: { avatarFileId: true, blade: true, forehandRubber: true, backhandRubber: true } },
  achievements: {
    select: ACHIEVEMENT_SELECT,
    // Свежие сверху: человек начинает рассказ с последнего.
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  },
  sportRank: { select: RANK_SELECT },
} satisfies Prisma.UserSelect;

type ProfileRow = Prisma.UserGetPayload<{ select: typeof PROFILE_SELECT }>;

/**
 * Профиль игрока: аватар, инвентарь, достижения, разряд.
 *
 * Расширение сверх ТЗ по решению владельца от 12.09.2026. Всё висит на
 * человеке, а не на клубе: аккаунт один на платформу, и разряд, подтверждённый
 * одним клубом, действует во всех.
 *
 * Заполняет профиль только сам человек — маршруты под `/me/player`. Клуб
 * профиль не правит: он проверяет разряд (см. RankReviewService).
 */
@Injectable()
export class PlayersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorage,
    private readonly intake: FileIntake,
    private readonly access: PlayerAccess,
    private readonly staff: StaffNotifier,
  ) {}

  /**
   * Профиль целиком — со сканом приказа и причиной отказа.
   *
   * Отдаётся самому человеку и администраторам его клубов; кто именно
   * спрашивает, проверяет вызывающий маршрут.
   */
  async profile(userId: string): Promise<PlayerProfile> {
    // Отключённого на платформе здесь находят: он не войдёт и сам не спросит,
    // а карточка у администратора не должна ломаться на ушедшем человеке.
    return toProfile(await this.load(userId, { withDeactivated: true }), new Date());
  }

  /**
   * Публичная страница игрока.
   *
   * Посторонний не отличит «профиль закрыт» от «такого человека нет»: и то и
   * другое — 404. Иначе по адресам страниц можно было бы собрать, кто на
   * платформе младше четырнадцати.
   */
  async publicProfile(playerId: string, viewerId: string | null): Promise<PublicPlayer> {
    const row = await this.load(playerId);
    const today = new Date();
    const owner = { ownerId: row.id, birthDate: row.birthDate };
    const viewer = await this.access.viewerOf(viewerId, row.id);

    if (!canSeeProfile(owner, viewer, today)) {
      throw new NotFoundException('Профиль игрока не найден');
    }

    const rank = row.sportRank;

    return {
      id: row.id,
      name: shortName(row.fullName),
      avatarFileId: row.playerProfile?.avatarFileId ?? null,
      equipment: equipmentOf(row),
      achievements: row.achievements.map(toAchievement),
      // Отклонённый разряд посторонним не показывается вовсе — см. PublicRank.
      rank:
        rank && rank.status !== SportRankStatus.REJECTED
          ? {
              rank: rank.rank as SportRankLevel,
              status: rank.status,
              verifiedBy: rank.status === SportRankStatus.VERIFIED ? reviewerOf(rank, false) : null,
            }
          : null,
      hiddenFromPublic: !isProfilePublic(row.birthDate, today),
    };
  }

  async updateEquipment(userId: string, dto: UpdateEquipmentDto): Promise<PlayerProfile> {
    // Только присланные поля: PATCH не стирает то, о чём его не спрашивали.
    const fields: { blade?: string | null; forehandRubber?: string | null; backhandRubber?: string | null } = {};

    if (dto.blade !== undefined) fields.blade = cleanText(dto.blade);
    if (dto.forehandRubber !== undefined) fields.forehandRubber = cleanText(dto.forehandRubber);
    if (dto.backhandRubber !== undefined) fields.backhandRubber = cleanText(dto.backhandRubber);

    await this.prisma.playerProfile.upsert({
      where: { userId },
      create: { userId, ...fields },
      update: fields,
    });

    return this.profile(userId);
  }

  /**
   * Новый аватар. Старый удаляется в той же транзакции — у человека один
   * аватар, и прежний снимок хранить незачем.
   */
  async setAvatar(userId: string, upload: Uint8Array | undefined): Promise<PlayerProfile> {
    // Перекодирование — до транзакции: sharp думает сотни миллисекунд, и
    // держать всё это время открытую транзакцию незачем.
    const prepared = await this.intake.prepare('AVATAR', upload);

    await this.prisma.$transaction(async (tx) => {
      const file = await this.storage.save(tx, {
        ownerUserId: userId,
        kind: StoredFileKind.AVATAR,
        contentType: prepared.contentType,
        data: prepared.data,
      });

      await tx.playerProfile.upsert({
        where: { userId },
        create: { userId, avatarFileId: file.id },
        update: { avatarFileId: file.id },
      });

      await this.storage.prune(tx, { ownerUserId: userId, kind: StoredFileKind.AVATAR, keepId: file.id });
    });

    return this.profile(userId);
  }

  async removeAvatar(userId: string): Promise<PlayerProfile> {
    await this.prisma.$transaction(async (tx) => {
      await tx.playerProfile.updateMany({ where: { userId }, data: { avatarFileId: null } });
      await this.storage.prune(tx, { ownerUserId: userId, kind: StoredFileKind.AVATAR, keepId: null });
    });

    return this.profile(userId);
  }

  async addAchievement(userId: string, dto: AchievementDto): Promise<PlayerProfile> {
    const count = await this.prisma.achievement.count({ where: { userId } });

    if (count >= MAX_ACHIEVEMENTS) {
      throw new BadRequestException(`Достижений — не больше ${MAX_ACHIEVEMENTS}`);
    }

    await this.prisma.achievement.create({ data: { userId, ...achievementData(dto) } });

    return this.profile(userId);
  }

  async updateAchievement(userId: string, id: string, dto: AchievementDto): Promise<PlayerProfile> {
    // Условие по владельцу — в самом обновлении: чужое достижение не
    // находится, а не «находится и запрещается».
    const updated = await this.prisma.achievement.updateMany({
      where: { id, userId },
      data: achievementData(dto),
    });

    if (updated.count === 0) {
      throw new NotFoundException('Достижение не найдено');
    }

    return this.profile(userId);
  }

  async removeAchievement(userId: string, id: string): Promise<PlayerProfile> {
    const removed = await this.prisma.achievement.deleteMany({ where: { id, userId } });

    if (removed.count === 0) {
      throw new NotFoundException('Достижение не найдено');
    }

    return this.profile(userId);
  }

  /**
   * Разряд: сам разряд, реквизиты приказа и скан — одним действием.
   *
   * Настоящая правка возвращает разряд на проверку и стирает прежнее решение
   * целиком: подпись «подтвердил клуб X» не должна висеть над тем, чего клуб
   * X не видел. Повтор того же самого ничего не меняет.
   */
  async setRank(userId: string, dto: SetRankDto, upload: Uint8Array | undefined): Promise<PlayerProfile> {
    if (upload && dto.removeDocument === 'true') {
      throw new BadRequestException('Либо приложите новый скан, либо уберите старый — не всё сразу');
    }

    const orderNumber = cleanText(dto.orderNumber);
    const orderDate = dto.orderDate ?? null;

    if (orderDate !== null && !parsePastDate(orderDate)) {
      throw new BadRequestException('Дата приказа — существующая дата и не в будущем');
    }

    const document = upload ? 'replace' : dto.removeDocument === 'true' ? 'remove' : 'keep';
    const prepared = upload ? await this.intake.prepare('RANK_DOCUMENT', upload) : null;

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.sportRank.findUnique({ where: { userId }, select: RANK_SELECT });

      const decision = decideRankEdit(current ? rankState(current) : null, {
        rank: dto.rank,
        orderNumber,
        orderDate,
        document,
      });

      if (!decision.ok) {
        throw new BadRequestException(decision.message);
      }

      if (!decision.changed) {
        return;
      }

      const file = prepared
        ? await this.storage.save(tx, {
            ownerUserId: userId,
            kind: StoredFileKind.RANK_DOCUMENT,
            contentType: prepared.contentType,
            data: prepared.data,
          })
        : null;

      const documentFileId =
        document === 'replace' ? file!.id : document === 'remove' ? null : (current?.documentFileId ?? null);

      const fields = {
        rank: dto.rank,
        orderNumber,
        orderDate: orderDate === null ? null : new Date(`${orderDate}T00:00:00Z`),
        documentFileId,
      };

      await tx.sportRank.upsert({
        where: { userId },
        create: { userId, ...fields },
        update: {
          ...fields,
          status: SportRankStatus.PENDING,
          reviewedByUserId: null,
          reviewedInTenantId: null,
          reviewedAt: null,
          rejectionReason: null,
        },
      });

      await this.storage.prune(tx, {
        ownerUserId: userId,
        kind: StoredFileKind.RANK_DOCUMENT,
        keepId: documentFileId,
      });

      // Настоящая правка разряда — снова на проверку: администраторам его клубов.
      await this.staff.rankPending(tx, userId);
    });

    return this.profile(userId);
  }

  /** Разряд целиком — вместе со сканом приказа. */
  async removeRank(userId: string): Promise<PlayerProfile> {
    await this.prisma.$transaction(async (tx) => {
      await tx.sportRank.deleteMany({ where: { userId } });
      await this.storage.prune(tx, { ownerUserId: userId, kind: StoredFileKind.RANK_DOCUMENT, keepId: null });
    });

    return this.profile(userId);
  }

  /**
   * Человек с профилем. Анонимизированный не находится никогда — его
   * персональные данные затёрты; отключённый на платформе — только когда об
   * этом просят явно: публичной страницы у него нет.
   */
  private async load(userId: string, options: { withDeactivated?: boolean } = {}): Promise<ProfileRow> {
    const row = await this.prisma.user.findFirst({
      where: {
        id: userId,
        anonymizedAt: null,
        ...(options.withDeactivated ? {} : { deactivatedAt: null }),
      },
      select: PROFILE_SELECT,
    });

    if (!row) {
      throw new NotFoundException('Профиль игрока не найден');
    }

    return row;
  }
}

function toProfile(row: ProfileRow, today: Date): PlayerProfile {
  return {
    userId: row.id,
    avatarFileId: row.playerProfile?.avatarFileId ?? null,
    equipment: equipmentOf(row),
    achievements: row.achievements.map(toAchievement),
    rank: row.sportRank ? toRank(row.sportRank) : null,
    isPublic: isProfilePublic(row.birthDate, today),
  };
}

function equipmentOf(row: ProfileRow) {
  return {
    blade: row.playerProfile?.blade ?? null,
    forehandRubber: row.playerProfile?.forehandRubber ?? null,
    backhandRubber: row.playerProfile?.backhandRubber ?? null,
  };
}

function toAchievement(row: Prisma.AchievementGetPayload<{ select: typeof ACHIEVEMENT_SELECT }>): PlayerAchievement {
  return {
    id: row.id,
    title: row.title,
    date: formatBirthDate(row.date),
    level: row.level,
    place: row.place,
    note: row.note,
  };
}

function toRank(row: RankRow): PlayerRank {
  return {
    rank: row.rank as SportRankLevel,
    status: row.status,
    orderNumber: row.orderNumber,
    orderDate: row.orderDate ? formatBirthDate(row.orderDate) : null,
    document: row.document,
    reviewedBy: row.status === SportRankStatus.PENDING ? null : reviewerOf(row, true),
    rejectionReason: row.rejectionReason,
    version: row.updatedAt.toISOString(),
  };
}

function reviewerOf(row: RankRow, withName: boolean) {
  if (!row.reviewedBy || !row.reviewedAt) {
    return null;
  }

  return {
    clubName: row.reviewedBy.tenant.name,
    clubSlug: row.reviewedBy.tenant.slug,
    at: row.reviewedAt.toISOString(),
    ...(withName ? { by: shortName(row.reviewedBy.user.fullName) } : {}),
  };
}

/** Разряд в том виде, в каком его читают правила. */
export function rankState(row: RankRow): RankState {
  return {
    rank: row.rank as SportRankLevel,
    orderNumber: row.orderNumber,
    orderDate: row.orderDate ? formatBirthDate(row.orderDate) : null,
    hasDocument: row.documentFileId !== null,
    status: row.status,
    rejectionReason: row.rejectionReason,
  };
}


function achievementData(dto: AchievementDto) {
  const title = cleanText(dto.title);

  if (!title) {
    throw new BadRequestException('Назовите соревнование');
  }

  const date = parsePastDate(dto.date);

  if (!date) {
    throw new BadRequestException('Дата соревнования — существующая дата и не в будущем');
  }

  return {
    title,
    date,
    level: dto.level,
    place: dto.place ?? null,
    note: cleanText(dto.note),
  };
}
