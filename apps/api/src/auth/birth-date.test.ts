import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatBirthDate, parseBirthDate } from './birth-date.ts';

const TODAY = new Date('2026-08-26T12:00:00Z');

describe('parseBirthDate', () => {
  it('разбирает обычную дату', () => {
    assert.equal(parseBirthDate('2001-05-17', TODAY)?.toISOString(), '2001-05-17T00:00:00.000Z');
  });

  it('сегодняшняя дата допустима', () => {
    // Человек, родившийся сегодня, — законный случай, пусть и редкий.
    assert.notEqual(parseBirthDate('2026-08-26', TODAY), null);
  });

  it('завтрашняя — нет', () => {
    assert.equal(parseBirthDate('2026-08-27', TODAY), null);
  });

  it('несуществующая дата отклоняется', () => {
    // 31 февраля Date молча превращает в 3 марта — без сверки обратно это
    // прошло бы насквозь.
    assert.equal(parseBirthDate('2001-02-31', TODAY), null);
    assert.equal(parseBirthDate('2001-13-01', TODAY), null);
  });

  it('слишком давняя дата отклоняется как опечатка', () => {
    assert.equal(parseBirthDate('1899-12-31', TODAY), null);
    assert.notEqual(parseBirthDate('1900-01-01', TODAY), null);
  });

  it('мусор и другой формат отклоняются', () => {
    assert.equal(parseBirthDate('17.05.2001', TODAY), null);
    assert.equal(parseBirthDate('2001-5-7', TODAY), null);
    assert.equal(parseBirthDate('', TODAY), null);
  });
});

describe('formatBirthDate', () => {
  it('отдаёт дату без времени', () => {
    assert.equal(formatBirthDate(new Date('2001-05-17T00:00:00Z')), '2001-05-17');
  });
});
