import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus, Prisma, StoredFileKind } from '@yenisey/database';
import type {
  CoachCard,
  CoachGroup,
  CoachInClub,
  CoachPrices,
  CoachStats,
  CoachStatsPeriod,
  PublicCoach,
} from '@yenisey/types';
import { shortName } from '@yenisey/types';
import { coachStats, periodStart } from './coach-stats';
import { FileIntake } from '../files/file-intake.service';
import { FileStorage } from '../files/file-storage';
import { PrismaService } from '../prisma/prisma.service';
import { checkPriceNote, checkText, parseSocialLinks, readSocialLinks } from './coach-rules';
import type { UpdateCoachCardDto, UpdateCoachPricesDto } from './dto/coach.dto';

const CARD_SELECT = {
  userId: true,
  photoFileId: true,
  achievements: true,
  inventory: true,
  socialLinks: true,
} satisfies Prisma.CoachCardSelect;

type CardRow = Prisma.CoachCardGetPayload<{ select: typeof CARD_SELECT }>;

const PRICES_SELECT = {
  groupPrice: true,
  individualPrice: true,
  priceNote: true,
} satisfies Prisma.CoachProfileSelect;

/**
 * Карточка тренера и его цены.
 *
 * Карточка ОДНА на человека и общая для всех клубов (решение владельца от
 * 20.09.2026): фотография, достижения, инвентарь и соцсети не меняются от
 * того, в каком зале человек сегодня тренирует. Заполняет её только он сам —
 * клуб карточку не правит, в отличие от того, что написано в ТЗ.
 *
 * Клубным осталось то, что у клубов действительно разное: цены за групповую и
 * индивидуальную тренировку. Они живут у пары «тренер + клуб», и правит их
 * тренер в разделе этого клуба.
 */
@Injectable()
export class CoachesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorage,
    private readonly intake: FileIntake,
  ) {}

  // --- Карточка (одна на человека) -----------------------------------------

  /**
   * Своя карточка. Её может ещё не быть — это не ошибка, тренер просто её не
   * открывал: отдаётся пустая, чтобы форме было что показать.
   */
  async card(userId: string): Promise<CoachCard> {
    await this.assertCoach(userId);

    const row = await this.prisma.coachCard.findUnique({ where: { userId }, select: CARD_SELECT });

    return row ? toCard(row) : emptyCard(userId);
  }

  async updateCard(userId: string, dto: UpdateCoachCardDto): Promise<CoachCard> {
    await this.assertCoach(userId);

    const fields: Prisma.CoachCardUpdateInput = {};

    for (const field of ['achievements', 'inventory'] as const) {
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

    await this.prisma.coachCard.upsert({
      where: { userId },
      create: { ...(fields as Prisma.CoachCardUncheckedCreateInput), userId },
      update: fields,
    });

    return this.card(userId);
  }

  /**
   * Новая фотография. Старая удаляется в той же транзакции — в карточке она
   * одна, и прежний снимок хранить незачем.
   */
  async setPhoto(userId: string, upload: Uint8Array | undefined): Promise<CoachCard> {
    await this.assertCoach(userId);

    // Перекодирование — до транзакции: sharp думает сотни миллисекунд.
    const prepared = await this.intake.prepare('COACH_PHOTO', upload);

    await this.prisma.$transaction(async (tx) => {
      const file = await this.storage.save(tx, {
        ownerUserId: userId,
        kind: StoredFileKind.COACH_PHOTO,
        contentType: prepared.contentType,
        data: prepared.data,
      });

      await tx.coachCard.upsert({
        where: { userId },
        create: { userId, photoFileId: file.id },
        update: { photoFileId: file.id },
      });

      await this.storage.prune(tx, { ownerUserId: userId, kind: StoredFileKind.COACH_PHOTO, keepId: file.id });
    });

    return this.card(userId);
  }

  async removePhoto(userId: string): Promise<CoachCard> {
    await this.assertCoach(userId);

    await this.prisma.$transaction(async (tx) => {
      await tx.coachCard.updateMany({ where: { userId }, data: { photoFileId: null } });
      await this.storage.prune(tx, { ownerUserId: userId, kind: StoredFileKind.COACH_PHOTO, keepId: null });
    });

    return this.card(userId);
  }

  // --- Цены (свои в каждом клубе) ------------------------------------------

  async prices(tenantId: string, userId: string): Promise<CoachPrices> {
    return this.loadPrices(tenantId, userId);
  }

  async updatePrices(tenantId: string, userId: string, dto: UpdateCoachPricesDto): Promise<CoachPrices> {
    await this.loadPrices(tenantId, userId);

    const note = checkPriceNote(dto.priceNote);

    if (!note.ok) {
      throw new BadRequestException(note.message);
    }

    await this.prisma.coachProfile.update({
      where: { userId_tenantId: { userId, tenantId } },
      data: {
        groupPrice: dto.groupPrice ?? null,
        individualPrice: dto.individualPrice ?? null,
        priceNote: note.value,
      },
    });

    return this.loadPrices(tenantId, userId);
  }

  /** Карточка и цены этого клуба — для карточки человека у администратора. */
  async inClub(tenantId: string, userId: string): Promise<CoachInClub | null> {
    const prices = await this.prisma.coachProfile.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      select: PRICES_SELECT,
    });

    if (!prices) {
      return null;
    }

    const row = await this.prisma.coachCard.findUnique({ where: { userId }, select: CARD_SELECT });

    return { card: row ? toCard(row) : emptyCard(userId), prices };
  }

  /**
   * Публичная страница тренера.
   *
   * Карточка одна, клубов может быть несколько — они перечисляются со своими
   * ценами. Отключённый в клубе в список не попадает; отключённый на
   * платформе не показывается вовсе.
   */
  async publicProfile(userId: string): Promise<PublicCoach> {
    const person = await this.prisma.user.findFirst({
      where: { id: userId, deactivatedAt: null, anonymizedAt: null },
      select: {
        fullName: true,
        coachCard: { select: CARD_SELECT },
        memberships: {
          where: { role: 'COACH', deactivatedAt: null, coachProfile: { isNot: null } },
          select: {
            tenant: { select: { name: true, slug: true } },
            coachProfile: { select: PRICES_SELECT },
          },
          orderBy: { tenant: { name: 'asc' } },
        },
      },
    });

    if (!person || person.memberships.length === 0) {
      throw new NotFoundException('Карточка тренера не найдена');
    }

    const card = person.coachCard ? toCard(person.coachCard) : emptyCard(userId);

    return {
      id: userId,
      // «Фамилия И.», как в списке мероприятий клуба: полные имена в браузер
      // не уходят даже с публичной страницы.
      name: shortName(person.fullName),
      photoFileId: card.photoFileId,
      achievements: card.achievements,
      inventory: card.inventory,
      socialLinks: card.socialLinks,
      clubs: person.memberships.map((membership) => ({
        name: membership.tenant.name,
        slug: membership.tenant.slug,
        groupPrice: membership.coachProfile?.groupPrice ?? null,
        individualPrice: membership.coachProfile?.individualPrice ?? null,
        priceNote: membership.coachProfile?.priceNote ?? null,
      })),
    };
  }

  // --- Группы и статистика (клубные) ---------------------------------------

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

  /**
   * Статистика по своим занятиям В ЭТОМ клубе.
   *
   * Тот же расчёт видит и тренер о себе, и клуб о тренере (ТЗ: «статистика
   * посещаемости доступна и по каждому тренеру»). Клубная она намеренно:
   * администратору «Енисея» незачем видеть, как тот же человек отработал в
   * соседнем клубе.
   */
  async stats(tenantId: string, coachId: string, period: CoachStatsPeriod): Promise<CoachStats> {
    // Не тренер этого клуба — 404, а не пустая статистика: «занятий нет» по
    // опечатке в адресе выглядело бы как настоящий ответ.
    await this.loadPrices(tenantId, coachId);

    const now = new Date();
    const from = periodStart(period, now);

    const sessions = await this.prisma.trainingSession.findMany({
      where: {
        tenantId,
        coachId,
        endsAt: { lte: now, ...(from ? { gte: from } : {}) },
      },
      select: {
        endsAt: true,
        capacity: true,
        bookings: { select: { status: true } },
      },
    });

    return coachStats(
      sessions.map((session) => ({
        endsAt: session.endsAt.toISOString(),
        capacity: session.capacity,
        entries: session.bookings.map((booking) => booking.status),
      })),
      period,
      now,
    );
  }

  /** Тренер этого клуба — иначе цен у него здесь нет. */
  private async loadPrices(tenantId: string, userId: string): Promise<CoachPrices> {
    const row = await this.prisma.coachProfile.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      select: PRICES_SELECT,
    });

    if (!row) {
      throw new NotFoundException('Тренер не найден в этом клубе');
    }

    return row;
  }

  /**
   * Карточку заводит и правит только тренер — хотя бы одного клуба.
   *
   * Клуба в адресе у этих маршрутов нет (карточка платформенная), поэтому
   * роль проверяется здесь: `RolesGuard` без клуба бессилен.
   */
  private async assertCoach(userId: string): Promise<void> {
    const coach = await this.prisma.coachProfile.findFirst({
      where: { userId, membership: { role: 'COACH', deactivatedAt: null } },
      select: { userId: true },
    });

    if (!coach) {
      throw new ForbiddenException('Карточка тренера — для тренеров клубов');
    }
  }
}

function toCard(row: CardRow): CoachCard {
  return {
    userId: row.userId,
    photoFileId: row.photoFileId,
    achievements: row.achievements,
    inventory: row.inventory,
    socialLinks: readSocialLinks(row.socialLinks),
  };
}

/** Карточки ещё нет: форме нужно что-то показать, а тренеру — что заполнить. */
function emptyCard(userId: string): CoachCard {
  return { userId, photoFileId: null, achievements: null, inventory: null, socialLinks: [] };
}
