import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus, Prisma, StoredFileKind } from '@yenisey/database';
import type { CoachGroup, CoachProfile, PublicCoach } from '@yenisey/types';
import { shortName } from '@yenisey/types';
import { FileIntake } from '../files/file-intake.service';
import { FileStorage } from '../files/file-storage';
import { PrismaService } from '../prisma/prisma.service';
import { checkText, parseSocialLinks, readSocialLinks } from './coach-rules';
import type { UpdateCoachProfileDto } from './dto/coach.dto';

const CARD_SELECT = {
  userId: true,
  photoFileId: true,
  achievements: true,
  inventory: true,
  priceInfo: true,
  socialLinks: true,
  tenant: { select: { name: true, slug: true } },
  membership: { select: { user: { select: { fullName: true } } } },
} satisfies Prisma.CoachProfileSelect;

type CardRow = Prisma.CoachProfileGetPayload<{ select: typeof CARD_SELECT }>;

/**
 * Карточка тренера: фотография, достижения, инвентарь, стоимость, соцсети.
 *
 * Карточка принадлежит КЛУБУ, а не человеку: ключ — пара «человек + клуб».
 * Поэтому все маршруты правки идут через `clubs/:slug/...`, и один тренер в
 * двух клубах ведёт две карточки с разной ценой.
 *
 * Правит её сам тренер или администратор его клуба — оба через одни и те же
 * методы, разница только в том, чей `userId` пришёл.
 */
@Injectable()
export class CoachesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorage,
    private readonly intake: FileIntake,
  ) {}

  /** Карточка тренера этого клуба. Нет пары «человек + клуб» — нет карточки. */
  async profile(tenantId: string, userId: string): Promise<CoachProfile> {
    return toProfile(await this.load(tenantId, userId));
  }

  /**
   * Карточка для карточки человека у администратора: её может не быть, и это
   * не ошибка — человек мог стать тренером минуту назад.
   */
  async profileOrNull(tenantId: string, userId: string): Promise<CoachProfile | null> {
    const row = await this.prisma.coachProfile.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      select: CARD_SELECT,
    });

    return row ? toProfile(row) : null;
  }

  /**
   * Публичная страница тренера.
   *
   * Клуба в адресе нет, а карточек у человека столько, сколько клубов, где он
   * тренирует, — показывается самая свежая, остальные клубы перечисляются
   * рядом. Пока клуб на платформе один, второй карточки не бывает; когда
   * клубов станет много, страницу стоит перевести на адрес с клубом.
   *
   * Отключённый в клубе или на платформе не показывается вовсе: 404, а не
   * пустая карточка.
   */
  async publicProfile(userId: string): Promise<PublicCoach> {
    const rows = await this.prisma.coachProfile.findMany({
      where: {
        userId,
        membership: {
          deactivatedAt: null,
          user: { deactivatedAt: null, anonymizedAt: null },
        },
      },
      select: CARD_SELECT,
      orderBy: { updatedAt: 'desc' },
    });

    const [row, ...others] = rows;

    if (!row) {
      throw new NotFoundException('Карточка тренера не найдена');
    }

    return {
      id: row.userId,
      // «Фамилия И.», как в списке мероприятий клуба: полные имена в браузер
      // не уходят даже с публичной страницы.
      name: shortName(row.membership.user.fullName),
      photoFileId: row.photoFileId,
      achievements: row.achievements,
      inventory: row.inventory,
      priceInfo: row.priceInfo,
      socialLinks: readSocialLinks(row.socialLinks),
      club: row.tenant,
      otherClubs: others.map((other) => other.tenant),
    };
  }

  /** Текстовые поля и ссылки. PATCH не стирает то, о чём его не спрашивали. */
  async update(tenantId: string, userId: string, dto: UpdateCoachProfileDto): Promise<CoachProfile> {
    await this.load(tenantId, userId);

    const fields: Prisma.CoachProfileUpdateInput = {};

    for (const field of ['achievements', 'inventory', 'priceInfo'] as const) {
      if (dto[field] === undefined) {
        continue;
      }

      const checked = checkText(field, dto[field]);

      if (!checked.ok) {
        throw new BadRequestException(checked.message);
      }

      fields[field] = checked.value;
    }

    if (dto.socialLinks !== undefined) {
      const links = parseSocialLinks(dto.socialLinks);

      if (!links.ok) {
        throw new BadRequestException(links.message);
      }

      // Json-поле принимает только структурный тип: интерфейс без индексной
      // сигнатуры Prisma не считает годным, хотя лежит в нём ровно он.
      fields.socialLinks = links.links as unknown as Prisma.InputJsonValue;
    }

    await this.prisma.coachProfile.update({
      where: { userId_tenantId: { userId, tenantId } },
      data: fields,
    });

    return this.profile(tenantId, userId);
  }

  /**
   * Новая фотография. Старая удаляется в той же транзакции — в карточке она
   * одна, и прежний снимок хранить незачем.
   */
  async setPhoto(tenantId: string, userId: string, upload: Uint8Array | undefined): Promise<CoachProfile> {
    await this.load(tenantId, userId);

    // Перекодирование — до транзакции: sharp думает сотни миллисекунд.
    const prepared = await this.intake.prepare('COACH_PHOTO', upload);

    await this.prisma.$transaction(async (tx) => {
      const file = await this.storage.save(tx, {
        ownerUserId: userId,
        kind: StoredFileKind.COACH_PHOTO,
        contentType: prepared.contentType,
        data: prepared.data,
      });

      await tx.coachProfile.update({
        where: { userId_tenantId: { userId, tenantId } },
        data: { photoFileId: file.id },
      });

      await this.storage.prune(tx, { ownerUserId: userId, kind: StoredFileKind.COACH_PHOTO, keepId: file.id });
    });

    return this.profile(tenantId, userId);
  }

  async removePhoto(tenantId: string, userId: string): Promise<CoachProfile> {
    await this.load(tenantId, userId);

    await this.prisma.$transaction(async (tx) => {
      await tx.coachProfile.updateMany({ where: { userId, tenantId }, data: { photoFileId: null } });
      await this.storage.prune(tx, { ownerUserId: userId, kind: StoredFileKind.COACH_PHOTO, keepId: null });
    });

    return this.profile(tenantId, userId);
  }

  /**
   * Занятия тренера вместе с составом — те, что ещё не кончились.
   *
   * Собирается здесь, а не экраном смены: тому нужны зал, дата, отметки и
   * деньги, а тренеру — только кто придёт. Отменившие в состав не попадают,
   * а отмеченные (пришёл, не пришёл) остаются: занятие идёт, и список не
   * должен редеть по ходу отметки.
   */
  async myGroups(tenantId: string, coachId: string): Promise<CoachGroup[]> {
    const sessions = await this.prisma.trainingSession.findMany({
      where: { tenantId, coachId, endsAt: { gte: new Date() } },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        capacity: true,
        trainingType: { select: { name: true } },
        bookings: {
          where: { status: { not: BookingStatus.CANCELLED } },
          select: {
            clientId: true,
            client: { select: { membership: { select: { user: { select: { fullName: true, phone: true } } } } } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { startsAt: 'asc' },
    });

    return sessions.map((session) => ({
      id: session.id,
      title: session.trainingType.name,
      startsAt: session.startsAt.toISOString(),
      endsAt: session.endsAt.toISOString(),
      capacity: session.capacity,
      participants: session.bookings.map((booking) => ({
        userId: booking.clientId,
        fullName: booking.client.membership.user.fullName,
        phone: booking.client.membership.user.phone,
      })),
    }));
  }

  private async load(tenantId: string, userId: string): Promise<CardRow> {
    const row = await this.prisma.coachProfile.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      select: CARD_SELECT,
    });

    if (!row) {
      throw new NotFoundException('Карточка тренера не найдена');
    }

    return row;
  }
}

function toProfile(row: CardRow): CoachProfile {
  return {
    userId: row.userId,
    photoFileId: row.photoFileId,
    achievements: row.achievements,
    inventory: row.inventory,
    priceInfo: row.priceInfo,
    socialLinks: readSocialLinks(row.socialLinks),
  };
}
