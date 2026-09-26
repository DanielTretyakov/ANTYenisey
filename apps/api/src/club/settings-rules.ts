import type { ClubSettings, ClubValue, Hall } from '@yenisey/types';

/**
 * Перекрёстные проверки настроек клуба и зала.
 *
 * Вынесены отдельными чистыми функциями, а не в декораторы DTO, по двум
 * причинам. Во-первых, правка настроек частичная: форма шлёт только
 * изменённое, и проверять «цены робота заданы» можно лишь на состоянии,
 * слитом с тем, что уже лежит в базе. Во-вторых, эти же правила продублированы
 * CHECK-констрейнтами в базе, и без них API отдавал бы человеку 500 вместо
 * внятного сообщения — а разъезд двух формулировок хочется видеть в тесте.
 */

/**
 * Настоящая ли это зона IANA.
 *
 * Опечатка «Asia/Krasnayarsk» тихо сломает расчёт порога отмены, границы
 * операционного дня и то, какой дате принадлежит расписание. Поэтому
 * проверяем не формат строки, а то, что зону знает сам движок дат: список зон
 * меняется вместе с политическими решениями, и держать его копию в коде
 * бессмысленно.
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Список нарушений в настройках клуба. Пустой массив — всё в порядке.
 *
 * Возвращается именно список, а не первая ошибка: человек, заполняющий форму,
 * должен увидеть все замечания разом, а не открывать их по одному.
 */
export function clubSettingsViolations(settings: ClubSettings): string[] {
  const violations: string[] = [];

  // Часового пояса здесь больше нет: он переехал на зал, и проверяется в
  // hallViolations. У клуба остались условия договора с клиентом.

  // Напоминание обязано приходить раньше, чем система сама зафиксирует
  // неявку, — иначе эскалация теряет смысл.
  if (settings.attendanceAutoNoShowAfterMinutes <= settings.attendanceReminderAfterMinutes) {
    violations.push(
      'Автоматическая неявка должна фиксироваться позже напоминания администратору',
    );
  }

  return violations;
}

/** Список нарушений в настройках зала. */
/** Поля зала, которые проверяются правилами; адрес проверяет справочник. */
export type HallRulesInput = Omit<Hall, 'id' | 'address' | 'addressFiasId' | 'latitude' | 'longitude' | 'phone' | 'email'>;

export function hallViolations(hall: HallRulesInput): string[] {
  const violations: string[] = [];

  if (hall.name.trim() === '') {
    violations.push('У зала должно быть название');
  }

  // Пояс проверяется здесь, а не в настройках клуба: он свойство ЗАЛА. Залы
  // одной организации бывают в разных регионах, и опечатка в зоне тихо
  // сломает расчёт порога отмены и границы операционного дня именно этого
  // зала — на глаз это выглядит как работающее приложение.
  if (!isValidTimezone(hall.timezone)) {
    violations.push(
      `Часовой пояс «${hall.timezone}» не найден. Ожидается зона IANA, например «Asia/Krasnoyarsk»`,
    );
  }

  // Зал с включённой опцией робота, но без цен, упрётся в NULL при первом же
  // расчёте стоимости — уже в проде и уже у клиента.
  if (hall.hasRobotOption) {
    const missing = (
      [
        ['robot30MinPrice', '30 минут'],
        ['robot60MinPrice', '60 минут'],
        ['robotExtra30MinPrice', 'каждые следующие 30 минут'],
      ] as const
    )
      .filter(([field]) => hall[field] === null)
      .map(([, label]) => label);

    if (missing.length > 0) {
      violations.push(`Опция робота включена, но не заданы цены: ${missing.join(', ')}`);
    }
  }

  return violations;
}

// --- Страница клуба: ценности и соцсети (решения владельца от 25.09.2026) ---

/** Тот же предел, что `MAX_CLUB_VALUES` в @yenisey/types и CHECK в базе. */
export const CLUB_VALUES_LIMIT = 6;
export const CLUB_VALUE_TITLE_MAX = 60;
export const CLUB_VALUE_TEXT_MAX = 300;

export type RuleResult<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Ценности из формы: пустые пункты (ни заголовка, ни текста) отбрасываются,
 * пункт без заголовка — ошибка, а не молча выброшенный текст. Пустой список
 * хранится как null: CHECK не примет пустой массив.
 */
export function parseClubValues(input: { title?: unknown; text?: unknown }[]): RuleResult<ClubValue[] | null> {
  const values: ClubValue[] = [];

  for (const item of input) {
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const text = typeof item.text === 'string' ? item.text.trim() : '';

    if (!title && !text) {
      continue;
    }

    if (!title) {
      return { ok: false, message: 'У каждой ценности нужен заголовок' };
    }

    if (title.length > CLUB_VALUE_TITLE_MAX) {
      return { ok: false, message: `Заголовок ценности — не длиннее ${CLUB_VALUE_TITLE_MAX} символов` };
    }

    if (text.length > CLUB_VALUE_TEXT_MAX) {
      return { ok: false, message: `Пояснение к ценности — не длиннее ${CLUB_VALUE_TEXT_MAX} символов` };
    }

    values.push({ title, text });
  }

  if (values.length > CLUB_VALUES_LIMIT) {
    return { ok: false, message: `Ценностей — не больше ${CLUB_VALUES_LIMIT}` };
  }

  return { ok: true, value: values.length > 0 ? values : null };
}

/**
 * Ценности из базы. Поле — Json, и что там лежит, база знает лишь до «массив
 * не длиннее шести»; негодное молча отбрасывается, как `readSocialLinks` у
 * тренера.
 */
export function readClubValues(raw: unknown): ClubValue[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter(
      (item): item is ClubValue =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as ClubValue).title === 'string' &&
        typeof (item as ClubValue).text === 'string' &&
        (item as ClubValue).title.trim() !== '',
    )
    .slice(0, CLUB_VALUES_LIMIT)
    .map((item) => ({ title: item.title, text: item.text }));
}

const SOCIAL = {
  vk: {
    hosts: ['vk.com', 'vk.ru', 'm.vk.com'],
    canonical: (host: string): string => (host === 'vk.ru' ? 'vk.ru' : 'vk.com'),
    path: /^\/[A-Za-z0-9_.]+$/,
    label: 'ВКонтакте',
  },
  max: {
    hosts: ['max.ru'],
    canonical: (): string => 'max.ru',
    path: /^\/[A-Za-z0-9_./-]+$/,
    label: 'MAX',
  },
} as const;

/**
 * Ссылка на страницу клуба во ВКонтакте или MAX.
 *
 * Правило, а не `@IsUrl`: адрес уходит в ссылку на открытой странице, и
 * `javascript:` выполнился бы у посетителя. Принимается и то, что человек
 * скопировал без схемы («vk.com/yenisey»), — сохраняется всегда
 * `https://домен/путь`, ровно в той форме, что примет CHECK в базе.
 * Пустое — «убрать ссылку».
 */
export function parseSocialUrl(kind: 'vk' | 'max', input: string | null): RuleResult<string | null> {
  const raw = input?.trim() ?? '';
  const rule = SOCIAL[kind];

  if (!raw) {
    return { ok: true, value: null };
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;

  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, message: `Ссылка ${rule.label}: не похоже на адрес страницы` };
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/, '');

  if (!['https:', 'http:'].includes(url.protocol) || !(rule.hosts as readonly string[]).includes(host)) {
    return { ok: false, message: `Ссылка ${rule.label}: нужен адрес на ${rule.hosts[0]}` };
  }

  if (!rule.path.test(path)) {
    return { ok: false, message: `Ссылка ${rule.label}: укажите страницу клуба, например https://${rule.hosts[0]}/yenisey` };
  }

  const value = `https://${rule.canonical(host)}${path}`;

  return value.length > 200
    ? { ok: false, message: `Ссылка ${rule.label}: не длиннее 200 символов` }
    : { ok: true, value };
}
