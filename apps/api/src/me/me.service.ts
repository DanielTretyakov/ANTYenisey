import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@yenisey/database';
import type { FavouriteClub, FeedEvent } from '@yenisey/types';
import { MAX_FAVOURITE_CLUBS } from '@yenisey/types';
import {
  TOURNAMENT_EVENT_SELECT,
  TRAINING_EVENT_SELECT,
  tournamentEvent,
  trainingEvent,
} from '../events/event-view';
import { distinctNearest } from './feed-rules';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Клуб мероприятия в ленте: минимум, которого хватает, чтобы его назвать,
 * открыть и покрасить. Тот же набор, что у записи в «Моих записях».
 */
const CLUB_SELECT = {
  select: { slug: true, name: true, accentColor: true },
} as const;

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
   * «Ближайшее в моих клубах» на стартовой: пять ближайших неповторяющихся
   * мероприятий клубов, отмеченных своими (правило — `distinctNearest`).
   *
   * Аренды столов в ленте нет (ТЗ → «Страница клуба»): к чужой броне стола
   * нельзя присоединиться, и лента состояла бы из строк, на которые невозможно
   * записаться.
   *
   * Кандидатов берётся с запасом — по `FEED_POOL` каждого вида: пять разных
   * мероприятий могут прятаться за десятком проведений одной группы. По виду
   * отдельно, а не на двоих: иначе клуб с плотным расписанием занятий вытеснил
   * бы из выборки все турниры.
   */
  async feed(userId: string, limit = 5): Promise<FeedEvent[]> {
    const favourites = await this.prisma.userClub.findMany({
      where: { userId },
      select: { tenantId: true },
    });

    if (favourites.length === 0) {
      return [];
    }

    const scope = {
      tenantId: { in: favourites.map((row) => row.tenantId) },
      startsAt: { gte: new Date() },
    };

    const [tournaments, sessions] = await Promise.all([
      this.prisma.tournament.findMany({
        where: scope,
        select: { ...TOURNAMENT_EVENT_SELECT, tenant: CLUB_SELECT },
        orderBy: { startsAt: 'asc' },
        take: FEED_POOL,
      }),
      this.prisma.trainingSession.findMany({
        where: scope,
        select: { ...TRAINING_EVENT_SELECT, tenant: CLUB_SELECT },
        orderBy: { startsAt: 'asc' },
        take: FEED_POOL,
      }),
    ]);

    const candidates = [
      ...tournaments.map((row) => ({
        event: { ...tournamentEvent(row, userId), club: row.tenant },
        startsAt: row.startsAt.toISOString(),
        sameAs: `${row.tenant.slug}:TOURNAMENT:${row.tournamentTypeId}`,
      })),
      ...sessions.map((row) => ({
        event: { ...trainingEvent(row, userId), club: row.tenant },
        startsAt: row.startsAt.toISOString(),
        sameAs: `${row.tenant.slug}:TRAINING:${row.trainingTypeId}`,
      })),
    ];

    return distinctNearest(candidates, limit).map((candidate) => candidate.event);
  }
}

/** Сколько проведений каждого вида рассматривать, выбирая пять разных. */
const FEED_POOL = 200;

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
