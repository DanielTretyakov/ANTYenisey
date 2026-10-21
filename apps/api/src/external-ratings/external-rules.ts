/**
 * Рейтинги игрока во внешних системах — ФНТР, RTTW, RTTF (решения владельца
 * от 20.10.2026): человек ничего не вводит, сервер раз в сутки сам находит его
 * по фамилии, имени и году рождения и показывает плашкой в профиле.
 *
 * Чистый модуль под тестами: `node --test` не принимает относительных
 * импортов (см. CLAUDE.md), всё внешнее приходит аргументами. Сеть — в
 * `ExternalRatingsService`, здесь — только разбор ответов и сверка.
 *
 * Главное правило сверки: **лучше без плашки, чем с чужим рейтингом.**
 * Однофамильцы есть всегда, поэтому совпадение должно быть единственным;
 * два кандидата, которых нечем различить, — не находка, а пропуск.
 */

export type ExternalSystem = 'FNTR' | 'RTTW' | 'RTTF';

/** Человек платформы, которого ищем. */
export interface Person {
  /** «Фамилия Имя Отчество» — как `User.fullName`. */
  fullName: string;
  /** Пусто — неизвестна (заглушка миграции `1900-01-01`). */
  birthDate: Date | null;
  gender: 'MALE' | 'FEMALE' | null;
  /**
   * Города его клубов (клуба и залов). Нужны источнику без дат рождения:
   * полное ФИО бывает общим, и «Иванов Пётр Сергеевич» из Читы — не наш
   * «Иванов Пётр Сергеевич» из Красноярска.
   */
  cities: string[];
}

/** Строка источника, приведённая к общему виду. */
export interface Candidate {
  externalId: string;
  lastName: string;
  firstName: string;
  /** Отчество, если источник его знает; пусто — неизвестно. */
  middleName: string | null;
  /** Пусто — источник даты рождения не знает (RTTW). */
  birthDate: string | null;
  /** Город игрока в источнике, как там написан («Забайкальский кр., Чита»). */
  city: string | null;
  rating: number;
  place: number | null;
  /** На какую дату рейтинг в источнике, «YYYY-MM-DD». */
  asOf: string | null;
}

/** Нашли — или почему нет: в журнал прохода, не человеку. */
export type MatchResult =
  | { found: true; candidate: Candidate }
  | { found: false; reason: 'AMBIGUOUS'; candidates: Candidate[] }
  | { found: false; reason: 'NO_NAME' | 'NO_BIRTH_DATE' | 'NO_CITY' | 'NOT_FOUND' };

/**
 * Имя для сравнения: строчными, «ё» = «е», без лишних пробелов и знаков
 * вопроса (RTTW пишет «Ябанжи Ольга ?», когда отчества не знает).
 */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[?.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** «Фамилия Имя Отчество» → части; без имени — пусто. */
export function splitFullName(fullName: string): { lastName: string; firstName: string; middleName: string | null } | null {
  const parts = normalizeName(fullName).split(' ').filter(Boolean);

  if (parts.length < 2) return null;

  return { lastName: parts[0]!, firstName: parts[1]!, middleName: parts.length > 2 ? parts.slice(2).join(' ') : null };
}

/**
 * Найти человека среди строк источника.
 *
 * Фамилия и имя — всегда. Год рождения — если источник его знает: тогда без
 * своей даты рождения искать нельзя (`NO_BIRTH_DATE`), а у двух кандидатов
 * одного года решает полная дата. Источник без дат (RTTW) сверяется по
 * отчеству: у нас оно есть — у кандидата должно совпасть; кандидатов всё
 * равно должно остаться ровно один.
 */
export function matchPerson(person: Person, candidates: Candidate[]): MatchResult {
  const name = splitFullName(person.fullName);

  if (!name) return { found: false, reason: 'NO_NAME' };

  const byName = candidates.filter(
    (row) => normalizeName(row.lastName) === name.lastName && normalizeName(row.firstName) === name.firstName,
  );

  if (byName.length === 0) return { found: false, reason: 'NOT_FOUND' };

  const dated = byName.some((row) => row.birthDate !== null);
  let pool = byName;

  if (dated) {
    if (!person.birthDate) return { found: false, reason: 'NO_BIRTH_DATE' };

    const ours = person.birthDate.toISOString().slice(0, 10);

    pool = pool.filter((row) => row.birthDate !== null && row.birthDate.slice(0, 4) === ours.slice(0, 4));

    if (pool.length > 1) {
      pool = pool.filter((row) => row.birthDate === ours);
    }
  } else {
    // Без дат одного ФИО мало: город источника обязан совпасть с городом
    // одного из клубов человека. Клубов нет — искать не по чему.
    const cities = person.cities.map(normalizeName).filter(Boolean);

    if (cities.length === 0) return { found: false, reason: 'NO_CITY' };

    pool = pool.filter((row) => row.city !== null && cityMatches(row.city, cities));

    if (name.middleName) {
      pool = pool.filter((row) => !row.middleName || normalizeName(row.middleName) === name.middleName);

      // Кандидат с тем же отчеством весомее кандидата без отчества.
      const exact = pool.filter((row) => row.middleName && normalizeName(row.middleName) === name.middleName);

      if (exact.length > 0) pool = exact;
    }
  }

  if (pool.length === 0) return { found: false, reason: 'NOT_FOUND' };
  // Несколько — решает сам человек: «выберите себя» (20.10.2026).
  if (pool.length > 1) return { found: false, reason: 'AMBIGUOUS', candidates: pool };

  return { found: true, candidate: pool[0]! };
}

/** Человек в проходе сверки по одной системе. */
export interface SyncTarget {
  userId: string;
  person: Person;
  /** Профиль, который он закрепил сам («это я!»); пусто — не закреплял. */
  claimedId: string | null;
}

export interface SyncPlan {
  /** Записать: найденный однозначно или закреплённый самим человеком. */
  ratings: { userId: string; candidate: Candidate; claimed: boolean }[];
  /**
   * Варианты «выберите себя» — на каждого, кого проход коснулся: пустой
   * список стирает прежние варианты.
   */
  choices: { userId: string; candidates: Candidate[] }[];
  /** Снять незакреплённую плашку: не нашёлся, нашлись несколько, спорный. */
  clear: string[];
  /** Почему не нашлись — в журнал прохода. */
  reasons: Record<string, number>;
}

/**
 * План прохода по одной системе.
 *
 * `pool(person)` — строки источника, где его искать; `null` — данных нет (не
 * скачалось), такого человека проход не трогает вовсе. `claimedBy` — кто какой
 * профиль закрепил: чужой закреплённый профиль другим не предлагается и не
 * достаётся.
 *
 * Закрепивший сам не перевыбирается: его профиль только обновляет числа, а
 * если в источнике его не нашлось — плашка остаётся прежней.
 */
export function planSync(
  targets: SyncTarget[],
  pool: (person: Person) => Candidate[] | null,
  claimedBy: Map<string, string>,
): SyncPlan {
  const plan: SyncPlan = { ratings: [], choices: [], clear: [], reasons: {} };
  const tentative: { userId: string; candidate: Candidate }[] = [];
  const count = (reason: string) => {
    plan.reasons[reason] = (plan.reasons[reason] ?? 0) + 1;
  };

  for (const { userId, person, claimedId } of targets) {
    const candidates = pool(person);
    if (candidates === null) continue;

    if (claimedId) {
      const own = candidates.find((row) => row.externalId === claimedId);
      if (own) plan.ratings.push({ userId, candidate: own, claimed: true });
      plan.choices.push({ userId, candidates: [] });
      continue;
    }

    const free = candidates.filter((row) => {
      const owner = claimedBy.get(row.externalId);
      return owner === undefined || owner === userId;
    });
    const result = matchPerson(person, free);

    if (result.found) {
      tentative.push({ userId, candidate: result.candidate });
      continue;
    }

    count(result.reason);
    plan.clear.push(userId);
    plan.choices.push({ userId, candidates: result.reason === 'AMBIGUOUS' ? result.candidates : [] });
  }

  // Профиль, подошедший нескольким нашим людям, не достаётся никому сам —
  // каждому из них он предлагается: «это вы?».
  const { kept, contested } = uniqueClaims(tentative);

  for (const { userId, candidate } of kept) {
    plan.ratings.push({ userId, candidate, claimed: false });
    plan.choices.push({ userId, candidates: [] });
  }

  for (const { userId, candidate } of tentative.filter((row) => contested.includes(row.userId))) {
    count('CONTESTED');
    plan.clear.push(userId);
    plan.choices.push({ userId, candidates: [candidate] });
  }

  return plan;
}

/** Как показать вариант человеку: «Иванов Пётр Сергеевич». */
export function candidateName(candidate: Candidate): string {
  return [candidate.lastName, candidate.firstName, candidate.middleName].filter(Boolean).join(' ');
}

/**
 * Город источника — «Забайкальский кр., Чита» или «Москва (Россия)»: наш
 * город должен стоять в нём отдельным словом (или словами), а не куском:
 * «Чита» не должна находиться в «Читинский».
 */
function cityMatches(sourceCity: string, cities: string[]): boolean {
  const words = ` ${normalizeName(sourceCity).replace(/[,()]/g, ' ').replace(/\s+/g, ' ')} `;

  return cities.some((city) => words.includes(` ${city} `));
}

/**
 * Один профиль источника — одному нашему человеку. Если под него подошли
 * несколько учёток (девять «Ивановых Петров Сергеевичей»), не достаётся
 * никому: какая из них — его, не знает никто.
 */
export function uniqueClaims<T extends { externalId: string }>(found: { userId: string; candidate: T }[]): {
  kept: { userId: string; candidate: T }[];
  contested: string[];
} {
  const claims = new Map<string, number>();

  for (const { candidate } of found) claims.set(candidate.externalId, (claims.get(candidate.externalId) ?? 0) + 1);

  return {
    kept: found.filter(({ candidate }) => claims.get(candidate.externalId) === 1),
    contested: found.filter(({ candidate }) => claims.get(candidate.externalId)! > 1).map(({ userId }) => userId),
  };
}

// ---------------------------------------------------------------------------
// ФНТР: открытое JSON сайта ttfr.ru (`/api/fntr/rating`), по 100 строк.
// ---------------------------------------------------------------------------

export interface FntrRow {
  id: number;
  first_name: string | null;
  last_name: string | null;
  birthday: string | null;
  city?: string | null;
  score: number | null;
  place: number | null;
  month: number | null;
  year: number | null;
}

/** Строка ФНТР → кандидат. Без очков — не кандидат: показывать нечего. */
export function fntrCandidate(row: FntrRow): Candidate | null {
  if (!row.last_name || !row.first_name || typeof row.score !== 'number') return null;

  return {
    externalId: String(row.id),
    lastName: row.last_name,
    firstName: row.first_name,
    middleName: null,
    birthDate: row.birthday && /^\d{4}-\d{2}-\d{2}$/.test(row.birthday) ? row.birthday : null,
    city: row.city ?? null,
    rating: Math.round(row.score),
    place: typeof row.place === 'number' && row.place > 0 ? row.place : null,
    // Рейтинг ФНТР — на первое число месяца.
    asOf: row.year && row.month ? `${row.year}-${String(row.month).padStart(2, '0')}-01` : null,
  };
}

// ---------------------------------------------------------------------------
// RTTW: HTML-страница одной буквы фамилии `r.ttw.ru/players/?litera=А`.
// ---------------------------------------------------------------------------

/** Буква страницы RTTW для фамилии: «Ё» лежит под «Е». */
export function rttwLetter(fullName: string): string | null {
  const first = fullName.trim().charAt(0).toUpperCase();

  if (!first) return null;

  return first === 'Ё' ? 'Е' : first;
}

/**
 * Строки таблицы игроков RTTW: имя со ссылкой `?id=`, город, турниры, игры,
 * В-П, рейтинг, дельта, дата. Имя — «Фамилия Имя Отчество»; строки, где имя
 * начинается с инициалов («А О Абрамович»), не разбираются — фамилию в них не
 * найти надёжно.
 */
export function parseRttwPage(html: string): Candidate[] {
  const result: Candidate[] = [];

  for (const [, row] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const id = /players\/\?id=([0-9a-f]+)/.exec(row ?? '')?.[1];
    const cells = [...(row ?? '').matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell]) => textOf(cell ?? ''));

    if (!id || cells.length < 8) continue;

    const parts = cells[0]!.split(' ').filter(Boolean);
    const rating = Number.parseFloat(cells[5]!.replace(',', '.'));
    const date = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(cells[7]!);

    if (parts.length < 2 || /^[А-ЯЁA-Z]$/i.test(parts[0]!.replace('.', '')) || !Number.isFinite(rating)) continue;

    result.push({
      externalId: id,
      lastName: parts[0]!,
      firstName: parts[1]!,
      middleName: parts.length > 2 && parts[2] !== '?' ? parts.slice(2).join(' ') : null,
      birthDate: null,
      city: cells[1] && cells[1] !== '--' ? cells[1] : null,
      rating: Math.round(rating),
      place: null,
      asOf: date ? `${date[3]}-${date[2]}-${date[1]}` : null,
    });
  }

  return result;
}

/** Адрес профиля в источнике — для ссылки с плашки. */
export function profileUrl(system: ExternalSystem, externalId: string): string {
  switch (system) {
    case 'FNTR':
      return `https://ttfr.ru/sportsman/${encodeURIComponent(externalId)}`;
    case 'RTTW':
      return `https://r.ttw.ru/players/?id=${encodeURIComponent(externalId)}`;
    case 'RTTF':
      return `https://rttf.ru/players/${encodeURIComponent(externalId)}`;
  }
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
