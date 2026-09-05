import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@yenisey/database';
import type { FavouriteClub, FeedEvent } from '@yenisey/types';
import { MAX_FAVOURITE_CLUBS } from '@yenisey/types';
import { PrismaService } from '../prisma/prisma.service';

/** Поля клуба для карточки «моего клуба» — те же, что в поиске. */
const CARD_SELECT = {
  slug: true,
  name: true,
  logoUrl: true,
  accentColor: true,
  city: { select: { name: true } },
  halls: { select: { city: { select: { name: true } } } },
} as const;

/**
 * Платформенный уровень аккаунта: мои клубы и лента их мероприятий.
 *
 * Клуба у этих операций нет вовсе — аккаунт один на всю платформу, и
 * спрашивать «мои клубы в каком клубе» бессмысленно.
 */
@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Мои клубы, в порядке занятых мест. */
  async listClubs(userId: string): Promise<FavouriteClub[]> {
    const rows = await this.prisma.userClub.findMany({
      where: { userId },
      select: { slot: true, tenant: { select: CARD_SELECT } },
      orderBy: { slot: 'asc' },
    });

    return rows.map((row) => ({ ...toCard(row.tenant), slot: row.slot }));
  }

  /**
   * Отметить клуб своим.
   *
   * Слот выбирается наименьший свободный: человеку места не показываются, для
   * него это просто «мои клубы». Гонку двух одновременных запросов разводит
   * база — уникальный индекс (userId, slot) и CHECK на диапазон 1..3, — а не
   * подсчёт здесь: два параллельных запроса оба прочитали бы «занято два» и
   * оба вставили бы третий с четвёртым.
   *
   * Повторная отметка уже отмеченного клуба — не ошибка: кнопка могла
   * сработать дважды, и отвечать на это отказом значило бы пугать человека
   * там, где ничего не произошло.
   */
  async addClub(userId: string, slug: string): Promise<FavouriteClub[]> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!tenant) {
      throw new NotFoundException('Клуб не найден');
    }

    const taken = await this.prisma.userClub.findMany({
      where: { userId },
      select: { tenantId: true, slot: true },
    });

    if (taken.some((row) => row.tenantId === tenant.id)) {
      return this.listClubs(userId);
    }

    const slot = firstFreeSlot(taken.map((row) => row.slot));

    if (slot === null) {
      throw new ConflictException(
        `Своими можно отметить не больше ${MAX_FAVOURITE_CLUBS} клубов. Снимите отметку с одного из них`,
      );
    }

    try {
      await this.prisma.userClub.create({ data: { userId, tenantId: tenant.id, slot } });
    } catch (error) {
      // Слот заняли между чтением и вставкой. Место арбитра — база, здесь
      // остаётся перевести её отказ на человеческий язык.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === 'P2010')
      ) {
        throw new ConflictException(
          `Своими можно отметить не больше ${MAX_FAVOURITE_CLUBS} клубов. Снимите отметку с одного из них`,
        );
      }

      throw error;
    }

    return this.listClubs(userId);
  }

  /** Снять отметку. Клуб при этом никуда не девается: записи и история целы. */
  async removeClub(userId: string, slug: string): Promise<FavouriteClub[]> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!tenant) {
      throw new NotFoundException('Клуб не найден');
    }

    await this.prisma.userClub.deleteMany({ where: { userId, tenantId: tenant.id } });

    return this.listClubs(userId);
  }

  /**
   * Лента ближайших мероприятий моих клубов — одним списком по времени.
   *
   * Аренды столов в ленте нет (ТЗ → «Страница клуба»): к чужой броне стола
   * нельзя присоединиться, и лента состояла бы из строк, на которые невозможно
   * записаться.
   */
  async feed(userId: string, limit = 12): Promise<FeedEvent[]> {
    const favourites = await this.prisma.userClub.findMany({
      where: { userId },
      select: { tenantId: true },
    });

    if (favourites.length === 0) {
      return [];
    }

    const tournaments = await this.prisma.tournament.findMany({
      where: {
        tenantId: { in: favourites.map((row) => row.tenantId) },
        startsAt: { gte: new Date() },
      },
      select: {
        id: true,
        startsAt: true,
        tenant: { select: { slug: true, name: true, accentColor: true } },
        tournamentType: { select: { name: true, ratingLabel: true, price: true } },
        registrations: {
          where: { status: 'BOOKED' },
          select: { clientId: true },
        },
      },
      orderBy: { startsAt: 'asc' },
      take: limit,
    });

    return tournaments.map((tournament) => ({
      id: tournament.id,
      club: tournament.tenant,
      title: tournament.tournamentType.name,
      ratingLabel: tournament.tournamentType.ratingLabel,
      startsAt: tournament.startsAt.toISOString(),
      price: tournament.tournamentType.price,
      registeredCount: tournament.registrations.length,
      registered: tournament.registrations.some((row) => row.clientId === userId),
    }));
  }
}

/**
 * Наименьшее свободное место, 1..3. `null` — все заняты.
 *
 * Именно наименьшее, а не «следующее за максимальным»: снятая отметка
 * освобождает место в середине, и без переиспользования человек с тремя
 * снятыми клубами не смог бы отметить ни одного.
 */
function firstFreeSlot(taken: number[]): number | null {
  for (let slot = 1; slot <= MAX_FAVOURITE_CLUBS; slot += 1) {
    if (!taken.includes(slot)) {
      return slot;
    }
  }

  return null;
}

/** Строка базы в карточку клуба. Города залов, совпадающие с основным, отбрасываются. */
function toCard(row: {
  slug: string;
  name: string;
  logoUrl: string | null;
  accentColor: string | null;
  city: { name: string } | null;
  halls: { city: { name: string } | null }[];
}) {
  const city = row.city?.name ?? null;

  return {
    slug: row.slug,
    name: row.name,
    logoUrl: row.logoUrl,
    accentColor: row.accentColor,
    city,
    otherCities: [
      ...new Set(
        row.halls
          .map((hall) => hall.city?.name)
          .filter((name): name is string => name != null && name !== city),
      ),
    ].sort(),
    hallCount: row.halls.length,
  };
}
