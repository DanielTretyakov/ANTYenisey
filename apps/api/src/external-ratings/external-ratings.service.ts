import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RatingSystem } from '@yenisey/database';
import { rttwFetchEnabled, webOrigin, type Env } from '../config/env';
import { BIRTH_PLACEHOLDER } from '../club/people-filter';
import { PrismaService } from '../prisma/prisma.service';
import {
  fntrCandidate,
  parseRttwPage,
  rttwLetter,
  candidateName,
  planSync,
  type Candidate,
  type FntrRow,
  type Person,
} from './external-rules';

/** Сколько строк ФНТР отдаёт за раз — больше сайт не принимает (422). */
const FNTR_PAGE = 100;
/** Пауза между запросами к одному источнику: мы гость на чужом сайте. */
const FNTR_PAUSE_MS = 1_000;
const RTTW_PAUSE_MS = 3_000;
const REQUEST_TIMEOUT_MS = 60_000;

type Target = { userId: string; person: Person };

export interface ExternalRatingsReport {
  people: number;
  /** По системе: сколько нашли, сколько сняли (не нашли или нашлись двое), не прошло ли скачивание. */
  systems: Partial<Record<RatingSystem, { found: number; cleared: number; choices: number; failed: boolean }>>;
}

/**
 * Ежедневная сверка внешних рейтингов (решения владельца от 20.10.2026).
 *
 * Список ФНТР скачивается ЦЕЛИКОМ (≈170 запросов по 100 строк) и сверяется у
 * нас: фамилии наших людей на сторону не уходят. RTTW — только страницы тех
 * букв, на которые начинаются фамилии наших людей, и только при RTTW_FETCH=on:
 * его robots.txt закрывает весь сайт. RTTF пока не читается — список его
 * игроков с нашей стороны недоступен, а поиск по имени закрыт его robots.txt.
 *
 * Источник не скачался — его строки не трогаем: вчерашняя плашка с датой
 * лучше пропавшей. Скачался, а человек не нашёлся или нашлись двое — строку
 * снимаем: лучше без плашки, чем с чужим рейтингом.
 */
@Injectable()
export class ExternalRatingsService {
  private readonly logger = new Logger(ExternalRatingsService.name);
  private running: Promise<ExternalRatingsReport> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Один проход; второй, начатый поверх первого, получает его же результат. */
  runOnce(): Promise<ExternalRatingsReport> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });

    return this.running;
  }

  private async run(): Promise<ExternalRatingsReport> {
    const targets = await this.targets();
    const report: ExternalRatingsReport = { people: targets.length, systems: {} };

    if (targets.length === 0) return report;

    report.systems.FNTR = await this.syncFntr(targets);

    if (rttwFetchEnabled({ RTTW_FETCH: this.config.get('RTTW_FETCH', { infer: true }) })) {
      report.systems.RTTW = await this.syncRttw(targets);
    }

    return report;
  }

  /** Кого ищем: живые учётки с ФИО. Дата-заглушка старых учёток — «неизвестна». */
  private async targets(): Promise<Target[]> {
    const users = await this.prisma.user.findMany({
      where: { deactivatedAt: null, anonymizedAt: null },
      select: {
        id: true,
        fullName: true,
        birthDate: true,
        gender: true,
        // Города клубов человека — для источника без дат рождения (RTTW).
        memberships: {
          where: { deactivatedAt: null },
          select: {
            tenant: {
              select: { city: { select: { name: true } }, halls: { select: { city: { select: { name: true } } } } },
            },
          },
        },
      },
    });

    return users.map((user) => ({
      userId: user.id,
      person: {
        fullName: user.fullName,
        birthDate: user.birthDate.toISOString().slice(0, 10) === BIRTH_PLACEHOLDER ? null : user.birthDate,
        gender: user.gender,
        cities: [
          ...new Set(
            user.memberships.flatMap(({ tenant }) => [
              tenant.city?.name,
              ...tenant.halls.map((hall) => hall.city?.name),
            ]),
          ),
        ].filter((city): city is string => !!city),
      },
    }));
  }

  // --- ФНТР ----------------------------------------------------------------

  private async syncFntr(targets: Target[]): Promise<{ found: number; cleared: number; choices: number; failed: boolean }> {
    const genders = new Set(targets.map((target) => target.person.gender));
    const lists: { male: Candidate[]; female: Candidate[] } = { male: [], female: [] };

    try {
      if (genders.has('MALE') || genders.has(null)) lists.male = await this.fntrList('male');
      if (genders.has('FEMALE') || genders.has(null)) lists.female = await this.fntrList('female');
    } catch (error) {
      this.logger.warn(`ФНТР не скачался, плашки остаются прежними: ${(error as Error).message}`);
      return { found: 0, cleared: 0, choices: 0, failed: true };
    }

    // Пол не указан — ищем в обоих списках: однофамилец другого пола
    // отсеется по имени и году.
    return this.apply(RatingSystem.FNTR, targets, (person) =>
      person.gender === 'MALE' ? lists.male : person.gender === 'FEMALE' ? lists.female : [...lists.male, ...lists.female],
    );
  }

  private async fntrList(gender: 'male' | 'female'): Promise<Candidate[]> {
    const rows: Candidate[] = [];
    let total = Infinity;

    for (let start = 0; start < total; start += FNTR_PAGE) {
      const url = `https://ttfr.ru/api/fntr/rating?${new URLSearchParams({ gender, start: String(start), limit: String(FNTR_PAGE) })}`;
      const body = (await this.getJson(url)) as { count?: unknown; data?: unknown };

      if (typeof body.count !== 'number' || !Array.isArray(body.data)) {
        throw new Error('ответ ФНТР не похож на список рейтинга');
      }

      total = body.count;

      for (const row of body.data as FntrRow[]) {
        const candidate = fntrCandidate(row);
        if (candidate) rows.push(candidate);
      }

      if (body.data.length === 0) break;
      await pause(FNTR_PAUSE_MS);
    }

    return rows;
  }

  // --- RTTW ----------------------------------------------------------------

  private async syncRttw(targets: Target[]): Promise<{ found: number; cleared: number; choices: number; failed: boolean }> {
    const letters = [...new Set(targets.map((target) => rttwLetter(target.person.fullName)).filter((letter): letter is string => !!letter))];
    const pages = new Map<string, Candidate[]>();

    for (const letter of letters) {
      try {
        pages.set(letter, parseRttwPage(await this.getText(`https://r.ttw.ru/players/?${new URLSearchParams({ litera: letter })}`)));
      } catch (error) {
        this.logger.warn(`RTTW, буква ${letter}: ${(error as Error).message}`);
      }

      await pause(RTTW_PAUSE_MS);
    }

    // Не скачалась буква — её люди не трогаются (`null` — пропустить).
    return this.apply(RatingSystem.RTTW, targets, (person) => pages.get(rttwLetter(person.fullName) ?? '') ?? null, letters.length > 0 && pages.size === 0);
  }

  // --- Запись ----------------------------------------------------------------

  /**
   * Сверка и запись по одной системе — исполнение `planSync`. `pool` вернул
   * `null` — данных по человеку нет (не скачалось), его строки не трогаем.
   */
  private async apply(
    system: RatingSystem,
    targets: Target[],
    pool: (person: Person) => Candidate[] | null,
    failed = false,
  ): Promise<{ found: number; cleared: number; choices: number; failed: boolean }> {
    const claimedRows = await this.prisma.externalRating.findMany({
      where: { system, claimedAt: { not: null } },
      select: { userId: true, externalId: true },
    });
    const claimedOf = new Map(claimedRows.map((row) => [row.userId, row.externalId]));
    const claimedBy = new Map(claimedRows.map((row) => [row.externalId, row.userId]));
    const plan = planSync(
      targets.map((target) => ({ ...target, claimedId: claimedOf.get(target.userId) ?? null })),
      pool,
      claimedBy,
    );
    const now = new Date();

    for (const { userId, candidate, claimed } of plan.ratings) {
      const data = {
        externalId: candidate.externalId,
        rating: candidate.rating,
        place: candidate.place,
        asOf: dayOf(candidate.asOf),
        checkedAt: now,
      };

      await this.prisma.externalRating.upsert({
        where: { userId_system: { userId, system } },
        create: { userId, system, ...data },
        // Закреплённую человеком строку сверка только обновляет: отметка
        // «это я» остаётся.
        update: claimed ? data : { ...data, claimedAt: null },
      });
    }

    // Снимается только незакреплённое: закреплённое человеком сверка не трогает.
    const cleared = plan.clear.length
      ? (await this.prisma.externalRating.deleteMany({ where: { system, userId: { in: plan.clear }, claimedAt: null } })).count
      : 0;

    // Варианты «выберите себя» — заново на каждого, кого проход коснулся.
    const touched = plan.choices.map((row) => row.userId);
    const offered = plan.choices.flatMap(({ userId, candidates }) =>
      candidates.map((candidate) => ({
        userId,
        system,
        externalId: candidate.externalId,
        name: candidateName(candidate).slice(0, 200),
        city: candidate.city,
        birthYear: candidate.birthDate ? Number(candidate.birthDate.slice(0, 4)) : null,
        rating: candidate.rating,
        place: candidate.place,
        asOf: dayOf(candidate.asOf),
      })),
    );

    await this.prisma.$transaction([
      this.prisma.externalRatingChoice.deleteMany({ where: { system, userId: { in: touched } } }),
      this.prisma.externalRatingChoice.createMany({ data: offered, skipDuplicates: true }),
    ]);

    const choosing = new Set(offered.map((row) => row.userId)).size;

    this.logger.log(
      `${system}: найдено ${plan.ratings.length}, снято ${cleared}, выбирают себя ${choosing}` +
        (Object.keys(plan.reasons).length
          ? ` (не найдены: ${Object.entries(plan.reasons).map(([reason, count]) => `${reason} ${count}`).join(', ')})`
          : ''),
    );

    return { found: plan.ratings.length, cleared, choices: choosing, failed };
  }
  // --- Сеть ------------------------------------------------------------------

  private headers(accept: string): Record<string, string> {
    // Представляемся: владелец источника должен видеть, кто ходит и куда писать.
    const site = webOrigin({
      WEB_ORIGIN: this.config.get('WEB_ORIGIN', { infer: true }),
      CORS_ORIGINS: this.config.get('CORS_ORIGINS', { infer: true }),
    });

    return { Accept: accept, 'User-Agent': `KNT-ratings/1.0 (+${site})` };
  }

  private async getJson(url: string): Promise<unknown> {
    const response = await fetch(url, { headers: this.headers('application/json'), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

    if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);

    return response.json();
  }

  private async getText(url: string): Promise<string> {
    const response = await fetch(url, { headers: this.headers('text/html'), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

    if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);

    return response.text();
  }
}

/** «YYYY-MM-DD» → дата для колонки DATE. */
function dayOf(day: string | null): Date | null {
  return day ? new Date(`${day}T00:00:00Z`) : null;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
