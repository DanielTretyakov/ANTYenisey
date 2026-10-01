import { Injectable } from '@nestjs/common';
import type { ClubRating, ClubRatingRow, ClubVisits, Gender, PlayerVisitTops, RatingPeriod } from '@yenisey/types';
import { PUBLIC_PROFILE_AGE, shortName } from '@yenisey/types';
import { bornRange } from '../club/people-filter';
import { localParts } from '../club/closures';
import { clubTimezone, FALLBACK_TIMEZONE } from '../notifications/clock';
import { participantView } from '../players/player-rules';
import { PrismaService } from '../prisma/prisma.service';
import { clubTops, periodStart, ranked, RATING_SIZE, type ClubTop } from './rating-rules';

interface VisitCount {
  userId: string;
  visits: number;
}

/**
 * Рейтинг посещений клуба (решение владельца от 26.09.2026): публичный, на
 * странице клуба.
 *
 * Визит — строка журнала визитов с «пришёл»: отметка на занятии, турнире,
 * аренде, спарринге ученика и визит с порога. Не больше одного в день —
 * занятие и аренда в один вечер это один приход в клуб. День — по поясу
 * клуба (старший зал), как у утренней сводки.
 *
 * В рейтинге нет скрывшихся (`User.ratingHidden`), отключённых на платформе
 * и в клубе и анонимизированных. Человек — по правилам окна мероприятия:
 * имя сокращено, у младше 14 ни ссылки, ни фото, ни пола.
 */
@Injectable()
export class RatingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Рейтинг за период; `gender` — только мужчины или только женщины (решение
   * владельца от 27.09.2026, окно «Подробнее»). В выборке по полу нет игроков
   * младше 14: их пол открытые списки не раскрывают, а строка в списке
   * «Женщины» раскрыла бы его сама.
   */
  async rating(
    tenantId: string,
    period: RatingPeriod,
    viewerId: string | null,
    gender: Gender | null = null,
  ): Promise<ClubRating> {
    const timezone = await clubTimezone(this.prisma, tenantId);
    const now = new Date();
    const since = periodStart(period, localParts(now, timezone).date);
    const adultsBornBy = bornRange(PUBLIC_PROFILE_AGE, undefined, now).to!;

    const counts = await this.prisma.$queryRaw<VisitCount[]>`
      SELECT v."clientId" AS "userId",
             COUNT(DISTINCT (v."visitedAt" AT TIME ZONE ${timezone})::date)::int AS "visits"
        FROM "VisitLog" v
        JOIN "User" u ON u."id" = v."clientId"
        JOIN "TenantMembership" m ON m."userId" = v."clientId" AND m."tenantId" = v."tenantId"
       WHERE v."tenantId" = ${tenantId}
         AND v."attended"
         AND (${since}::date IS NULL OR (v."visitedAt" AT TIME ZONE ${timezone})::date >= ${since}::date)
         AND NOT u."ratingHidden"
         AND u."deactivatedAt" IS NULL
         AND u."anonymizedAt" IS NULL
         AND m."deactivatedAt" IS NULL
         AND (${gender}::text IS NULL OR (u."gender"::text = ${gender} AND u."birthDate" <= ${adultsBornBy}::date))
       GROUP BY v."clientId"`;

    const people = await this.prisma.user.findMany({
      where: { id: { in: counts.map((row) => row.userId) } },
      select: {
        id: true,
        fullName: true,
        birthDate: true,
        gender: true,
        playerProfile: { select: { avatarFileId: true } },
      },
    });

    const byId = new Map(people.map((person) => [person.id, person]));
    const rows = ranked(
      counts
        .filter((row) => byId.has(row.userId))
        .map((row) => ({ ...row, name: shortName(byId.get(row.userId)!.fullName) })),
    ).map((row): ClubRatingRow & { ownerId: string } => {
      const person = byId.get(row.userId)!;

      return {
        ownerId: row.userId,
        place: row.place,
        visits: row.visits,
        ...participantView(
          {
            userId: person.id,
            name: row.name,
            birthDate: person.birthDate,
            avatarFileId: person.playerProfile?.avatarFileId ?? null,
            gender: person.gender,
          },
          now,
        ),
      };
    });

    const viewer = viewerId
      ? await this.prisma.user.findUnique({ where: { id: viewerId }, select: { ratingHidden: true } })
      : null;

    // Своё место находится по владельцу строки, а не по `userId` кружка: у
    // игрока младше 14 его в кружке нет, а своё место знать он вправе.
    const mine = viewerId ? rows.find((row) => row.ownerId === viewerId) : undefined;

    return {
      period,
      gender,
      since,
      rows: rows.slice(0, RATING_SIZE).map(withoutOwner),
      me: mine ? withoutOwner(mine) : null,
      meHidden: viewer ? viewer.ratingHidden : null,
    };
  }

  /**
   * «Больше всего посещений» в профиле игрока (решение владельца от
   * 30.09.2026): топ-3 клубов за месяц, год и всё время. Визит — день с
   * отметкой «пришёл» по поясу клуба (старший зал — как `clubTimezone`),
   * поэтому день считается в запросе, а «сегодня» — у каждого клуба своё.
   */
  async playerTops(userId: string, hiddenFromOthers: boolean): Promise<PlayerVisitTops> {
    const days = await this.prisma.$queryRaw<{ tenantId: string; date: string; zone: string }[]>`
      SELECT DISTINCT v."tenantId",
             to_char(v."visitedAt" AT TIME ZONE tz.zone, 'YYYY-MM-DD') AS "date",
             tz.zone
        FROM "VisitLog" v
        CROSS JOIN LATERAL (
          SELECT COALESCE(
            (SELECT h."timezone" FROM "Hall" h WHERE h."tenantId" = v."tenantId" ORDER BY h."createdAt" LIMIT 1),
            ${FALLBACK_TIMEZONE}
          ) AS zone
        ) tz
       WHERE v."clientId" = ${userId}
         AND v."attended"`;

    const tenants = await this.prisma.tenant.findMany({
      where: { id: { in: [...new Set(days.map((day) => day.tenantId))] } },
      select: { id: true, slug: true, name: true, accentColor: true, logoUrl: true },
    });
    const byId = new Map(tenants.map((tenant) => [tenant.id, tenant]));
    const zones = new Map(days.map((day) => [day.tenantId, day.zone]));
    const now = new Date();

    const tops = clubTops(
      days.filter((day) => byId.has(day.tenantId)),
      (tenantId) => localParts(now, zones.get(tenantId) ?? FALLBACK_TIMEZONE).date,
      (tenantId) => byId.get(tenantId)!.name,
    );

    const view = (rows: ClubTop[]): ClubVisits[] =>
      rows.map((row) => {
        const { id: _id, ...club } = byId.get(row.tenantId)!;

        return { ...club, place: row.place, visits: row.visits };
      });

    return { month: view(tops.month), year: view(tops.year), all: view(tops.all), hiddenFromOthers };
  }

  /** Выключатель «не показывать меня» — во всех клубах сразу. */
  async setHidden(userId: string, hidden: boolean): Promise<{ hidden: boolean }> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { ratingHidden: hidden },
      select: { ratingHidden: true },
    });

    return { hidden: user.ratingHidden };
  }
}

function withoutOwner({ ownerId: _owner, ...row }: ClubRatingRow & { ownerId: string }): ClubRatingRow {
  return row;
}
