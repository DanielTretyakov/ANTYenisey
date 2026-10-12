import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { foldLine, icsFile, icsInstant, icsText } from './ics.ts';

describe('файл календаря', () => {
  it('время — в UTC без разделителей', () => {
    assert.equal(icsInstant('2026-10-12T12:00:00.000Z'), '20261012T120000Z');
  });

  it('служебные знаки экранируются', () => {
    assert.equal(icsText('Тренировка, зал «Баки»; стол 1\nвход со двора'), 'Тренировка\\, зал «Баки»\\; стол 1\\nвход со двора');
  });

  it('длинная строка переносится по 75 байт и не режет букву', () => {
    const line = `SUMMARY:${'Ж'.repeat(60)}`;
    const folded = foldLine(line).split('\r\n');

    assert.ok(folded.length > 1);
    assert.ok(folded.every((part) => new TextEncoder().encode(part).length <= 75));
    assert.equal(folded.map((part, index) => (index === 0 ? part : part.slice(1))).join(''), line);
  });

  it('событие целиком', () => {
    const file = icsFile(
      {
        uid: 'entry-1@knt',
        title: 'Детская тренировка · АНТ «Енисей»',
        startsAt: '2026-10-12T11:00:00.000Z',
        endsAt: '2026-10-12T12:30:00.000Z',
        location: 'Баки, Стол 1',
        url: 'https://ant-yenisey.ru/my-bookings',
      },
      new Date('2026-10-10T00:00:00.000Z'),
    );

    assert.match(file, /^BEGIN:VCALENDAR\r\n/);
    assert.match(file, /\r\nUID:entry-1@knt\r\n/);
    assert.match(file, /\r\nDTSTART:20261012T110000Z\r\nDTEND:20261012T123000Z\r\n/);
    assert.match(file, /\r\nLOCATION:Баки\\, Стол 1\r\n/);
    assert.match(file, /END:VCALENDAR\r\n$/);
    assert.doesNotMatch(file, /DESCRIPTION/);
  });
});
