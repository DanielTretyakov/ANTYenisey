/**
 * Кто может записаться на мероприятие (решения владельца от 20.10.2026).
 *
 * Ограничения — у ВИДА занятия или турнира, на все его проведения: «Детская
 * тренировка — 7–13 лет», «Турнир к 8 марта — только женщины». Возраст и пол
 * проверяет сервер при записи — и самозаписи, и записи клубом по звонку, без
 * обхода. Рейтинг система не проверяет: это справка с названием системы
 * (RTTW, RTTF, ФНТР), допуск по нему решают на месте соревнований.
 *
 * Живёт в общем пакете: те же подписи и тот же отказ видит веб, и разойтись
 * «для кого» в окне мероприятия с тем, что ответит сервер, им нельзя.
 */
import { fullYears } from './age';
import type { Gender } from './auth';

/** Рейтинговые системы настольного тенниса — для справочной планки турнира. */
export type RatingSystem = 'RTTW' | 'RTTF' | 'FNTR';

export const RATING_SYSTEMS: readonly RatingSystem[] = ['RTTW', 'RTTF', 'FNTR'];

export const RATING_SYSTEM_LABEL: Record<RatingSystem, string> = {
  RTTW: 'RTTW',
  RTTF: 'RTTF',
  FNTR: 'ФНТР',
};

/** Возраст в полных годах на день проведения и пол; пусто — без предела. */
export interface EventRestrictions {
  minAge: number | null;
  maxAge: number | null;
  gender: Gender | null;
}

/** Тот, за кого записывают: сам человек, ребёнок родителя или клиент у стойки. */
export interface Entrant {
  /** Пусто — неизвестна (заглушка миграции `1900-01-01`). */
  birthDate: Date | null;
  gender: Gender | null;
}

/** Ограничений нет вовсе — вид открыт всем. */
export function unrestricted(restrictions: EventRestrictions): boolean {
  return restrictions.minAge === null && restrictions.maxAge === null && restrictions.gender === null;
}

/**
 * «Для кого» одной строкой: «7–13 лет · только женщины». Пусто — ограничений
 * нет. Возраст включительно с обеих сторон: «до 13» — тринадцатилетнему можно.
 */
export function restrictionsLabel(restrictions: EventRestrictions): string | null {
  const parts: string[] = [];
  const { minAge, maxAge, gender } = restrictions;

  if (minAge !== null && maxAge !== null) {
    parts.push(minAge === maxAge ? `${minAge} ${yearsWord(minAge)}` : `${minAge}–${maxAge} ${yearsWord(maxAge)}`);
  } else if (minAge !== null) {
    parts.push(`с ${minAge} ${fromYears(minAge)}`);
  } else if (maxAge !== null) {
    parts.push(`до ${maxAge} ${fromYears(maxAge)}`);
  }

  if (gender) {
    parts.push(gender === 'FEMALE' ? 'только женщины' : 'только мужчины');
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Справочная планка рейтинга: «рейтинг ФНТР до 100». Без системы — как было до
 * 20.10.2026, «рейтинг до 100». Пусто — планки нет.
 */
export function ratingText(system: RatingSystem | null, label: string | null): string | null {
  if (!label) return null;

  return system ? `рейтинг ${RATING_SYSTEM_LABEL[system]} до ${label}` : `рейтинг до ${label}`;
}

/**
 * Приписка к названию мероприятия. Число, уже стоящее в названии, не
 * повторяется: «Клуб 100 рейтинг до 100» читается как опечатка, — но система
 * всё равно называется: «Клуб 100 · рейтинг ФНТР».
 */
export function ratingNote(title: string, system: RatingSystem | null, label: string | null): string | null {
  if (!label) return null;

  if (title.includes(label)) {
    return system ? `рейтинг ${RATING_SYSTEM_LABEL[system]}` : null;
  }

  return ratingText(system, label);
}

/**
 * Почему записать нельзя — или `null`, если можно.
 *
 * Возраст — полные годы на ДЕНЬ проведения, как у спарринга: детская группа
 * через месяц после 14-летия уже не детская. Неизвестные дата рождения или пол
 * при действующем ограничении — отказ с подсказкой, где их указать: пустить
 * «на всякий случай» значило бы открыть детскую группу всем старым учёткам.
 */
export function eligibilityProblem(
  event: { name: string; kind: 'TRAINING' | 'TOURNAMENT' },
  restrictions: EventRestrictions,
  entrant: Entrant,
  on: Date,
): string | null {
  const { minAge, maxAge, gender } = restrictions;
  const day = event.kind === 'TRAINING' ? 'на день занятия' : 'на день турнира';

  if (minAge !== null || maxAge !== null) {
    if (!entrant.birthDate) {
      return `«${event.name}» — по возрасту, а дата рождения участника не указана. Её вносит администратор клуба`;
    }

    const age = fullYears(entrant.birthDate, on);

    if (minAge !== null && age < minAge) {
      return `«${event.name}» — с ${minAge} ${fromYears(minAge)}, участнику ${day} ${age} ${yearsWord(age)}`;
    }

    if (maxAge !== null && age > maxAge) {
      return `«${event.name}» — до ${maxAge} ${fromYears(maxAge)} включительно, участнику ${day} ${age} ${yearsWord(age)}`;
    }
  }

  if (gender !== null) {
    if (!entrant.gender) {
      return `«${event.name}» — только для ${gender === 'FEMALE' ? 'женщин' : 'мужчин'}, а пол участника не указан. Его указывают в личных данных кабинета`;
    }

    if (entrant.gender !== gender) {
      return `«${event.name}» — только для ${gender === 'FEMALE' ? 'женщин' : 'мужчин'}`;
    }
  }

  return null;
}

/**
 * Разбор ограничений из формы вида. Повторяет CHECK'и `*_restrictions_sane`,
 * но отвечает по-человечески раньше них.
 */
export function restrictionsProblem(restrictions: EventRestrictions): string | null {
  for (const age of [restrictions.minAge, restrictions.maxAge]) {
    if (age !== null && (!Number.isInteger(age) || age < 0 || age > 120)) {
      return 'Возраст — целым числом лет, от 0 до 120';
    }
  }

  if (restrictions.minAge !== null && restrictions.maxAge !== null && restrictions.minAge > restrictions.maxAge) {
    return 'Возраст «от» больше, чем «до», — на такое не запишется никто';
  }

  return null;
}

/** «1 год», «2 года», «5 лет». */
function yearsWord(count: number): string {
  const tens = count % 100;
  const ones = count % 10;

  if (tens >= 11 && tens <= 14) return 'лет';
  if (ones === 1) return 'год';
  if (ones >= 2 && ones <= 4) return 'года';

  return 'лет';
}

/** Родительный падеж после «с» и «до»: «с 1 года», «до 21 года», «с 14 лет». */
function fromYears(count: number): string {
  return count % 10 === 1 && count % 100 !== 11 ? 'года' : 'лет';
}
