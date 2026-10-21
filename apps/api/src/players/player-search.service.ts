import { Injectable } from '@nestjs/common';
import { Prisma } from '@yenisey/database';
import { PUBLIC_PROFILE_AGE, type PlayerSearchPage, type PlayerSearchRow, type PlayerSearchSort } from '@yenisey/types';
import { bornRange } from '../club/people-filter';
import { PrismaService } from '../prisma/prisma.service';
import { parsePlayerQuery, surnameAndName } from './player-search-rules';

/** Пояс клуба без залов — тот же запасной, что у рейтинга посещений. */
const FALLBACK_TIMEZONE = 'Asia/Krasnoyarsk';

type Row = {
  id: string;
  fullName: string;
  birthDate: Date;
  gender: 'MALE' | 'FEMALE' | null;
  avatarFileId: string | null;
  isCoach: boolean;
  fntr: number | null;
  rttw: number | null;
  rttf: number | null;
};

/**
 * «Найти игрока» — глобальный поиск игроков и тренеров с рейтингами (решения
 * владельца от 20.10.2026).
 *
 * Кто в выдаче: живые учётки с 14 лет, кроме поставивших «не показывать меня в
 * рейтингах» — флажок один на рейтинг посещений и этот поиск. Детей нет вовсе:
 * их профили закрыты, и поиск собрал бы их список с годами и клубами.
 *
 * Имя — «Фамилия Имя» и год рождения (не дата): так пишут и рейтинги ФНТР и
 * RTTF, а тёзок иначе не различить.
 */
@Injectable()
export class PlayerSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(input: { query?: string; sort?: PlayerSearchSort; limit?: number; offset?: number }): Promise<PlayerSearchPage> {
    const { words, year } = parsePlayerQuery(input.query ?? '');
    const adultsBornBy = bornRange(PUBLIC_PROFILE_AGE, undefined, new Date()).to!;
    const limit = Math.min(input.limit ?? 30, 100);
    const offset = input.offset ?? 0;

    const filters = [
      Prisma.sql`u."deactivatedAt" IS NULL`,
      Prisma.sql`u."anonymizedAt" IS NULL`,
      Prisma.sql`NOT u."ratingHidden"`,
      Prisma.sql`u."birthDate" <= ${adultsBornBy}::date`,
      // «ё» = «е», регистр не важен; каждое слово запроса — где угодно в ФИО.
      ...words.map(
        (word) => Prisma.sql`translate(u."fullName", 'Ёё', 'Ее') ILIKE ${`%${word.replace(/[\\%_]/g, (char) => `\\${char}`)}%`}`,
      ),
      ...(year ? [Prisma.sql`EXTRACT(YEAR FROM u."birthDate") = ${year}`] : []),
    ];
    const where = Prisma.join(filters, ' AND ');

    const order = {
      name: Prisma.sql`u."fullName" ASC`,
      FNTR: Prisma.sql`f."rating" DESC NULLS LAST, u."fullName" ASC`,
      RTTW: Prisma.sql`w."rating" DESC NULLS LAST, u."fullName" ASC`,
      RTTF: Prisma.sql`t."rating" DESC NULLS LAST, u."fullName" ASC`,
    }[input.sort ?? 'name'];

    const ratingsJoin = Prisma.sql`
      LEFT JOIN "ExternalRating" f ON f."userId" = u."id" AND f."system" = 'FNTR'
      LEFT JOIN "ExternalRating" w ON w."userId" = u."id" AND w."system" = 'RTTW'
      LEFT JOIN "ExternalRating" t ON t."userId" = u."id" AND t."system" = 'RTTF'`;

    const [rows, counted] = await Promise.all([
      this.prisma.$queryRaw<Row[]>`
        SELECT u."id", u."fullName", u."birthDate", u."gender"::text AS "gender",
               p."avatarFileId",
               EXISTS (
                 SELECT 1 FROM "TenantMembership" m
                   JOIN "Tenant" tn ON tn."id" = m."tenantId"
                   JOIN "CoachProfile" cp ON cp."userId" = m."userId" AND cp."tenantId" = m."tenantId"
                  WHERE m."userId" = u."id" AND 'COACH' = ANY (m."roles"::text[])
                    AND m."deactivatedAt" IS NULL AND tn."publishedAt" IS NOT NULL
               ) AS "isCoach",
               f."rating" AS "fntr", w."rating" AS "rttw", t."rating" AS "rttf"
          FROM "User" u
          LEFT JOIN "PlayerProfile" p ON p."userId" = u."id"
          ${ratingsJoin}
         WHERE ${where}
         ORDER BY ${order}
         LIMIT ${limit} OFFSET ${offset}`,
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT COUNT(*)::int AS "total" FROM "User" u WHERE ${where}`,
    ]);

    const topClubs = await this.topClubs(rows.map((row) => row.id));

    return {
      total: counted[0]?.total ?? 0,
      rows: rows.map(
        (row): PlayerSearchRow => ({
          id: row.id,
          name: surnameAndName(row.fullName),
          birthYear: row.birthDate.getUTCFullYear() > 1900 ? row.birthDate.getUTCFullYear() : null,
          avatarFileId: row.avatarFileId,
          gender: row.gender,
          isCoach: row.isCoach,
          topClub: topClubs.get(row.id) ?? null,
          ratings: { FNTR: row.fntr, RTTW: row.rttw, RTTF: row.rttf },
        }),
      ),
    };
  }

  /**
   * Самый посещаемый открытый клуб за последние 365 дней: визит — день с «пришёл»
   * по поясу клуба (старший зал), как в рейтинге посещений. Поровну — по
   * названию клуба.
   */
  private async topClubs(userIds: string[]): Promise<Map<string, PlayerSearchRow['topClub']>> {
    if (userIds.length === 0) return new Map();

    const rows = await this.prisma.$queryRaw<{ userId: string; slug: string; name: string; accentColor: string | null }[]>`
      SELECT DISTINCT ON (x."clientId") x."clientId" AS "userId", tn."slug", tn."name", tn."accentColor"
        FROM (
          SELECT v."clientId", v."tenantId",
                 COUNT(DISTINCT (v."visitedAt" AT TIME ZONE tz.zone)::date) AS "days"
            FROM "VisitLog" v
            CROSS JOIN LATERAL (
              SELECT COALESCE(
                (SELECT h."timezone" FROM "Hall" h WHERE h."tenantId" = v."tenantId" ORDER BY h."createdAt" LIMIT 1),
                ${FALLBACK_TIMEZONE}
              ) AS zone
            ) tz
           WHERE v."clientId" IN (${Prisma.join(userIds)})
             AND v."attended"
             AND v."visitedAt" >= now() - interval '365 days'
           GROUP BY v."clientId", v."tenantId"
        ) x
        JOIN "Tenant" tn ON tn."id" = x."tenantId" AND tn."publishedAt" IS NOT NULL
       ORDER BY x."clientId", x."days" DESC, tn."name" ASC`;

    return new Map(rows.map(({ userId, ...club }) => [userId, club]));
  }
}
