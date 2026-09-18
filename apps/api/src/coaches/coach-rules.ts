/**
 * Правила карточки тренера: что принимается в текстовые поля и в ссылки.
 *
 * Чистый модуль без относительных импортов: его гоняет `node --test`, а тот
 * требует расширение `.ts` в пути, которого не принимает сборка. Общий пакет
 * импортируется по имени, это не относительный путь.
 */
import { MAX_COACH_SOCIAL_LINKS, type CoachSocialLink } from '@yenisey/types';

/** Границы текстовых полей. Те же цифры держит CHECK `CoachProfile_text_filled`. */
export const COACH_TEXT_LIMITS = {
  achievements: 2000,
  inventory: 1000,
  priceInfo: 500,
} as const;

export const MAX_SOCIAL_LABEL = 50;
export const MAX_SOCIAL_URL = 300;

export type Decision<T> = ({ ok: true } & T) | { ok: false; message: string };

/**
 * Строка из формы → то, что кладётся в базу: без пробелов по краям, пусто —
 * это null. Два написания «ничего не указано» база не примет.
 */
export function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';

  return trimmed === '' ? null : trimmed;
}

/**
 * Ссылки на соцсети.
 *
 * Только `http` и `https`: `javascript:` в адресе — это код, который выполнит
 * браузер посетителя, открывшего публичную страницу. Пустой список — законное
 * «ссылок нет», и он же стирает прежние.
 */
export function parseSocialLinks(links: CoachSocialLink[] | undefined): Decision<{ links: CoachSocialLink[] }> {
  if (links === undefined) {
    return { ok: true, links: [] };
  }

  if (links.length > MAX_COACH_SOCIAL_LINKS) {
    return { ok: false, message: `Ссылок — не больше ${MAX_COACH_SOCIAL_LINKS}` };
  }

  const parsed: CoachSocialLink[] = [];

  for (const link of links) {
    const label = cleanText(link?.label);
    const url = cleanText(link?.url);

    if (!label || !url) {
      return { ok: false, message: 'У каждой ссылки должны быть подпись и адрес' };
    }

    if (label.length > MAX_SOCIAL_LABEL) {
      return { ok: false, message: `Подпись ссылки — не длиннее ${MAX_SOCIAL_LABEL} символов` };
    }

    if (url.length > MAX_SOCIAL_URL) {
      return { ok: false, message: `Адрес ссылки — не длиннее ${MAX_SOCIAL_URL} символов` };
    }

    if (!isWebUrl(url)) {
      return { ok: false, message: `Адрес «${label}» должен начинаться с http:// или https://` };
    }

    parsed.push({ label, url });
  }

  return { ok: true, links: parsed };
}

function isWebUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Текстовое поле карточки.
 *
 * Длина проверяется здесь, а не только CHECK'ом: отказ базы человеку ничего не
 * объясняет, а поле у него длинное и набранное вручную.
 */
export function checkText(
  field: keyof typeof COACH_TEXT_LIMITS,
  value: string | null | undefined,
): Decision<{ value: string | null }> {
  const cleaned = cleanText(value);
  const limit = COACH_TEXT_LIMITS[field];

  if (cleaned && cleaned.length > limit) {
    return { ok: false, message: `${FIELD_NAMES[field]} — не длиннее ${limit} символов` };
  }

  return { ok: true, value: cleaned };
}

const FIELD_NAMES: Record<keyof typeof COACH_TEXT_LIMITS, string> = {
  achievements: 'Достижения',
  inventory: 'Инвентарь',
  priceInfo: 'Стоимость',
};

/**
 * Разбор `socialLinks` из базы: поле Json, и что в нём лежит, база не знает.
 *
 * Строка, написанная прошлой версией формы или руками через Studio, не должна
 * ронять публичную страницу — негодное молча отбрасывается.
 */
export function readSocialLinks(value: unknown): CoachSocialLink[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) {
      return [];
    }

    const { label, url } = item as { label?: unknown; url?: unknown };

    if (typeof label !== 'string' || typeof url !== 'string' || !isWebUrl(url)) {
      return [];
    }

    return [{ label, url }];
  });
}
