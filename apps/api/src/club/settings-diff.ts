/**
 * Что именно меняет отложенная правка настроек — по строке на поле, для
 * списка «Запланировано» и сообщения персоналу (решение владельца от
 * 26.09.2026: всем сотрудникам — кто, что и когда).
 *
 * Чистый модуль без относительных импортов — его гоняет `node --test`.
 */
import { formatRubles } from '@yenisey/types';

type Format = 'text' | 'money' | 'percent' | 'minutes' | 'bool' | 'step' | 'city';

interface FieldSpec {
  label: string;
  format: Format;
}

/** Настройки клуба, которые ждут полуночи. Оформление страницы сюда не входит. */
export const CLUB_DEFERRED_FIELDS: Record<string, FieldSpec> = {
  name: { label: 'Название', format: 'text' },
  cityId: { label: 'Город', format: 'city' },
  phone: { label: 'Телефон', format: 'text' },
  email: { label: 'Почта', format: 'text' },
  vkUrl: { label: 'ВКонтакте', format: 'text' },
  maxUrl: { label: 'MAX', format: 'text' },
  noShowChargePercent: { label: 'Списание за неявку', format: 'percent' },
  attendanceReminderAfterMinutes: { label: 'Напоминание об отметке', format: 'minutes' },
  attendanceAutoNoShowAfterMinutes: { label: 'Автонеявка', format: 'minutes' },
  subscriptionBurnsOnNoShowOnly: { label: 'Визит абонемента сгорает только при неявке', format: 'bool' },
};

/** Поля зала. Код ФИАС и координаты не показываются — их несёт адрес. */
export const HALL_FIELDS: Record<string, FieldSpec> = {
  name: { label: 'Название', format: 'text' },
  timezone: { label: 'Часовой пояс', format: 'text' },
  cityId: { label: 'Город', format: 'city' },
  address: { label: 'Адрес', format: 'text' },
  phone: { label: 'Телефон', format: 'text' },
  email: { label: 'Почта', format: 'text' },
  bookingStep: { label: 'Шаг брони', format: 'step' },
  tableHourPrice: { label: 'Час аренды', format: 'money' },
  tableExtra30MinPrice: { label: 'Следующие 30 минут', format: 'money' },
  hasRobotOption: { label: 'Аренда с роботом', format: 'bool' },
  robot30MinPrice: { label: 'Робот, 30 минут', format: 'money' },
  robot60MinPrice: { label: 'Робот, час', format: 'money' },
  robotExtra30MinPrice: { label: 'Робот, следующие 30 минут', format: 'money' },
};

/** Поля, которые пишутся вместе с адресом, но сами в сводке не видны. */
const SILENT_HALL_FIELDS = ['addressFiasId', 'latitude', 'longitude'];

const STEP_LABELS: Record<string, string> = {
  MIN_10: '10 минут',
  MIN_15: '15 минут',
  MIN_20: '20 минут',
  MIN_30: '30 минут',
  HOUR_1: 'час',
};

/** Как показать значение поля человеку. `cities` — названия городов по id. */
export function formatValue(format: Format, value: unknown, cities: Record<string, string> = {}): string {
  if (value === null || value === undefined || value === '') {
    return 'не задано';
  }

  switch (format) {
    case 'money':
      return formatRubles(Number(value));
    case 'percent':
      return `${String(value)} %`;
    case 'minutes':
      return `${String(value)} мин`;
    case 'bool':
      return value ? 'да' : 'нет';
    case 'step':
      return STEP_LABELS[String(value)] ?? String(value);
    case 'city':
      return cities[String(value)] ?? String(value);
    default:
      return `«${String(value)}»`;
  }
}

const same = (a: unknown, b: unknown): boolean => (a ?? null) === (b ?? null);

/**
 * Изменённые поля: только присланные (`undefined` — «не трогать») и
 * отличающиеся от текущего. Форма шлёт всё, что на ней есть, и без этой
 * выборки пересохранение формы ставило бы в очередь каждое поле заново —
 * и откатывало бы уже запланированную правку к старому значению.
 */
export function changedFields(
  fields: Record<string, FieldSpec>,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  cities: Record<string, string> = {},
  silent: readonly string[] = [],
): { data: Record<string, unknown>; lines: string[] } {
  const data: Record<string, unknown> = {};
  const lines: string[] = [];

  for (const [field, spec] of Object.entries(fields)) {
    if (after[field] === undefined || same(before[field], after[field])) {
      continue;
    }

    data[field] = after[field];
    lines.push(
      `${spec.label}: ${formatValue(spec.format, before[field], cities)} → ${formatValue(spec.format, after[field], cities)}`,
    );
  }

  // Код дома и координаты едут вместе с адресом и отдельной строки не дают.
  for (const field of silent) {
    if (after[field] !== undefined && !same(before[field], after[field])) {
      data[field] = after[field];
    }
  }

  return { data, lines };
}

/** Правка зала: то же, плюс код дома и координаты рядом с адресом. */
export function hallChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  cities: Record<string, string> = {},
): { data: Record<string, unknown>; lines: string[] } {
  return changedFields(HALL_FIELDS, before, after, cities, SILENT_HALL_FIELDS);
}

/** Описание нового зала: название, адрес, цена часа, столы. */
export function hallCreatedLines(hall: {
  name: string;
  address: string | null;
  tableHourPrice: number;
  tableCount: number;
}): string[] {
  return [
    `Новый зал «${hall.name}»`,
    `Адрес: ${hall.address ?? 'не задан'}`,
    `Час аренды: ${formatRubles(hall.tableHourPrice)}`,
    hall.tableCount > 0 ? `Столов: ${hall.tableCount}` : 'Столов пока нет',
  ];
}

/** «Стол 1» … «Стол N» — названия столов, заведённых вместе с залом. */
export function defaultTableLabels(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `Стол ${index + 1}`);
}

/**
 * Ближайшая полночь — дата, с которой правка в силе: «2026-09-26» → «2026-09-27».
 * Момент считает сервис по поясу зала: у залов в разных регионах полночь
 * наступает в разное время.
 */
export function nextDate(today: string): string {
  const value = new Date(`${today}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);

  return value.toISOString().slice(0, 10);
}

/** «2026-09-27» → «27 сентября в 00:00» — для сообщения и списка. */
export function effectiveLabel(date: string): string {
  const day = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(
    new Date(`${date}T00:00:00Z`),
  );

  return `${day} в 00:00`;
}
