/**
 * Часовые пояса, в которых может жить клуб.
 *
 * Список закрытый и короткий: в России одиннадцать зон, и выбор из них
 * надёжнее свободного ввода — опечатка «Asia/Krasnayarsk» проходит все
 * проверки формата и ломается только при расчёте порога отмены.
 *
 * Смещение не записано числом, а считается по самой зоне (см. `zoneOffset`):
 * регионы иногда переезжают между поясами, и подпись, вбитая руками, тихо
 * разошлась бы с настоящим временем клуба. Перевода на летнее время в России
 * нет с 2014 года, поэтому смещение постоянно и одной подписи достаточно.
 */
export const RUSSIAN_TIMEZONES: { id: string; city: string }[] = [
  { id: 'Europe/Kaliningrad', city: 'Калининград' },
  { id: 'Europe/Moscow', city: 'Москва, Санкт-Петербург' },
  { id: 'Europe/Samara', city: 'Самара, Ижевск' },
  { id: 'Asia/Yekaterinburg', city: 'Екатеринбург, Пермь, Уфа' },
  { id: 'Asia/Omsk', city: 'Омск' },
  { id: 'Asia/Krasnoyarsk', city: 'Красноярск, Новосибирск, Кемерово' },
  { id: 'Asia/Irkutsk', city: 'Иркутск, Улан-Удэ' },
  { id: 'Asia/Yakutsk', city: 'Якутск, Чита, Благовещенск' },
  { id: 'Asia/Vladivostok', city: 'Владивосток, Хабаровск' },
  { id: 'Asia/Magadan', city: 'Магадан, Южно-Сахалинск' },
  { id: 'Asia/Kamchatka', city: 'Петропавловск-Камчатский, Анадырь' },
];

/**
 * Смещение зоны от UTC в виде «UTC+7».
 *
 * Считается по текущему моменту через сам движок дат: держать копию таблицы
 * смещений в коде — значит однажды разойтись с реальностью.
 */
export function zoneOffset(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    }).formatToParts(new Date());

    const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? '';

    // Формат приходит как «GMT+07:00»; ровный час показываем без минут —
    // «UTC+7» читается быстрее, а зон с получасовым сдвигом в России нет.
    const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);

    if (!match) {
      // GMT без смещения — это ровно UTC.
      return 'UTC+0';
    }

    const [, sign, hours, minutes] = match;
    const hour = Number(hours);

    return minutes === '00'
      ? `UTC${sign}${hour}`
      : `UTC${sign}${hour}:${minutes}`;
  } catch {
    return '';
  }
}

/**
 * Варианты для выпадающего списка.
 *
 * Если у клуба записана зона не из списка — она добавляется отдельным
 * вариантом, а не подменяется ближайшей: молча переписать клубу часовой пояс
 * значит сдвинуть ему все пороги отмены.
 */
export function timezoneOptions(current: string): { value: string; label: string }[] {
  const known = RUSSIAN_TIMEZONES.map((zone) => ({
    value: zone.id,
    label: `${zone.city} — ${zoneOffset(zone.id)}`,
  }));

  if (known.some((option) => option.value === current)) {
    return known;
  }

  const offset = zoneOffset(current);

  return [
    { value: current, label: offset ? `${current} — ${offset}` : current },
    ...known,
  ];
}

/**
 * Смещение зоны от UTC в минутах на конкретный момент.
 *
 * Считается сравнением одного и того же мгновения, разобранного в нужной зоне
 * и в UTC. Способ окольный, но единственный без сторонней библиотеки — и
 * честный: он спрашивает у движка дат, а не у таблицы в коде.
 */
export function offsetMinutes(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);

  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  const asIfUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );

  // Миллисекунды отбрасываем: их нет в разобранных частях, и без округления
  // смещение получало бы дробный хвост.
  return (asIfUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000;
}

/**
 * Дата и время, введённые администратором **по времени клуба**, — в мгновение
 * UTC.
 *
 * Браузер администратора может стоять в другом поясе: клуб во Владивостоке
 * администрируют из Москвы — штатная ситуация. Поэтому местное время браузера
 * здесь не участвует вовсе.
 *
 * @param date «2026-03-12»
 * @param time «15:00»
 */
export function zonedToInstant(date: string, time: string, timezone: string): Date | null {
  const parsed = Date.parse(`${date}T${time}:00Z`);

  if (Number.isNaN(parsed)) {
    return null;
  }

  // Смещение берётся на сам этот момент, а не на «сейчас»: у зон с переводом
  // часов оно разное летом и зимой. В России перевода нет с 2014 года, но
  // платформа не обязана оставаться только российской.
  const offset = offsetMinutes(new Date(parsed), timezone);

  return new Date(parsed - offset * 60_000);
}

/** Мгновение UTC → «12.03.2026, 15:00» по времени клуба. */
export function formatInstant(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}
