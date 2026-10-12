/**
 * «Добавить в календарь» у записи (решение владельца от 12.10.2026): файл
 * .ics, который открывают календари телефона и почты. Без сервера — запись
 * уже у браузера, и ничего, кроме неё, файлу не нужно.
 *
 * Время — в UTC (`…Z`): календарь сам покажет его по часам телефона, а
 * описание часового пояса в файле (VTIMEZONE) сверх этого ничего не даёт.
 * Модуль без относительных импортов — его тесты идут через `node --test`.
 */

export interface IcsEvent {
  /** Постоянный идентификатор: повторный импорт обновит событие, а не задвоит. */
  uid: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location?: string | null;
  description?: string | null;
  url?: string | null;
}

/** RFC 5545: «20261012T120000Z». */
export function icsInstant(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Запятая, точка с запятой, обратная косая и перенос строки — экранируются. */
export function icsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/**
 * Длинная строка переносится по 75 байт, продолжение — с пробела. Режем по
 * символам, считая байты UTF-8: кириллица — по два, и разрезать букву
 * пополам нельзя.
 */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;

  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    const limit = parts.length === 0 ? 75 : 74;

    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }

    current += char;
    bytes += size;
  }

  parts.push(current);

  return parts.join('\r\n ');
}

export function icsFile(event: IcsEvent, now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KNT//Booking//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${icsInstant(now.toISOString())}`,
    `DTSTART:${icsInstant(event.startsAt)}`,
    `DTEND:${icsInstant(event.endsAt)}`,
    `SUMMARY:${icsText(event.title)}`,
    ...(event.location ? [`LOCATION:${icsText(event.location)}`] : []),
    ...(event.description ? [`DESCRIPTION:${icsText(event.description)}`] : []),
    ...(event.url ? [`URL:${event.url}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
