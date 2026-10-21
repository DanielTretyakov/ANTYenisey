import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  eligibilityProblem,
  ratingNote,
  ratingText,
  restrictionsLabel,
  restrictionsProblem,
  unrestricted,
  type EventRestrictions,
} from '@yenisey/types';

/**
 * Кто может записаться (решения владельца от 20.10.2026). Правило живёт в
 * @yenisey/types — его видит и веб; проверяется здесь, где есть `node --test`.
 */
const OPEN: EventRestrictions = { minAge: null, maxAge: null, gender: null };
const KIDS: EventRestrictions = { minAge: 7, maxAge: 13, gender: null };
const WOMEN: EventRestrictions = { minAge: null, maxAge: null, gender: 'FEMALE' };
const TRAINING = { name: 'Детская тренировка', kind: 'TRAINING' as const };
const TOURNAMENT = { name: 'Турнир к 8 марта', kind: 'TOURNAMENT' as const };

describe('eligibilityProblem', () => {
  it('25-летнего на детскую тренировку не пускает — тот самый случай из прогона', () => {
    const problem = eligibilityProblem(
      TRAINING,
      KIDS,
      { birthDate: new Date('2001-05-17T00:00:00Z'), gender: 'MALE' },
      new Date('2026-10-20T12:00:00Z'),
    );

    assert.match(problem ?? '', /до 13 лет включительно, участнику на день занятия 25 лет/);
  });

  it('возраст — на день проведения, а не на сегодня: в день 14-летия уже нельзя', () => {
    const born = new Date('2012-11-01T00:00:00Z');

    assert.equal(eligibilityProblem(TRAINING, KIDS, { birthDate: born, gender: null }, new Date('2026-10-31T12:00:00Z')), null);
    assert.match(
      eligibilityProblem(TRAINING, KIDS, { birthDate: born, gender: null }, new Date('2026-11-01T12:00:00Z')) ?? '',
      /14 лет/,
    );
  });

  it('границы включительно с обеих сторон', () => {
    const on = new Date('2026-10-20T12:00:00Z');

    assert.equal(eligibilityProblem(TRAINING, KIDS, { birthDate: new Date('2019-10-20T00:00:00Z'), gender: null }, on), null);
    assert.match(
      eligibilityProblem(TRAINING, KIDS, { birthDate: new Date('2019-10-21T00:00:00Z'), gender: null }, on) ?? '',
      /с 7 лет, участнику на день занятия 6 лет/,
    );
  });

  it('по полу: мужчину на женский турнир не пускает, женщину пускает', () => {
    const on = new Date('2027-03-08T10:00:00Z');
    const born = new Date('1990-01-01T00:00:00Z');

    assert.match(eligibilityProblem(TOURNAMENT, WOMEN, { birthDate: born, gender: 'MALE' }, on) ?? '', /только для женщин/);
    assert.equal(eligibilityProblem(TOURNAMENT, WOMEN, { birthDate: born, gender: 'FEMALE' }, on), null);
  });

  it('неизвестные пол или дата рождения при ограничении — отказ с подсказкой, где указать', () => {
    const on = new Date('2026-10-20T12:00:00Z');

    assert.match(eligibilityProblem(TOURNAMENT, WOMEN, { birthDate: null, gender: null }, on) ?? '', /пол участника не указан/);
    assert.match(eligibilityProblem(TRAINING, KIDS, { birthDate: null, gender: 'MALE' }, on) ?? '', /администратор клуба/);
  });

  it('без ограничений пускает всех, даже без даты рождения и пола', () => {
    assert.equal(unrestricted(OPEN), true);
    assert.equal(eligibilityProblem(TRAINING, OPEN, { birthDate: null, gender: null }, new Date()), null);
  });
});

describe('restrictionsLabel', () => {
  it('подписи «для кого»', () => {
    assert.equal(restrictionsLabel(OPEN), null);
    assert.equal(restrictionsLabel(KIDS), '7–13 лет');
    assert.equal(restrictionsLabel({ minAge: 18, maxAge: null, gender: 'FEMALE' }), 'с 18 лет · только женщины');
    assert.equal(restrictionsLabel({ minAge: null, maxAge: 21, gender: null }), 'до 21 года');
    assert.equal(restrictionsLabel({ minAge: 22, maxAge: 22, gender: 'MALE' }), '22 года · только мужчины');
  });
});

describe('restrictionsProblem', () => {
  it('«от» больше «до» и возраст вне 0..120 — отказ', () => {
    assert.match(restrictionsProblem({ minAge: 14, maxAge: 10, gender: null }) ?? '', /не запишется никто/);
    assert.match(restrictionsProblem({ minAge: 121, maxAge: null, gender: null }) ?? '', /от 0 до 120/);
    assert.equal(restrictionsProblem(KIDS), null);
  });
});

describe('ratingText и ratingNote', () => {
  it('система называется, число из названия не повторяется', () => {
    assert.equal(ratingText('FNTR', '100'), 'рейтинг ФНТР до 100');
    assert.equal(ratingText(null, '100'), 'рейтинг до 100');
    assert.equal(ratingText('RTTF', null), null);
    assert.equal(ratingNote('Клуб 100', 'RTTW', '100'), 'рейтинг RTTW');
    assert.equal(ratingNote('Клуб 100', null, '100'), null);
    assert.equal(ratingNote('Абсолют', 'RTTF', '300'), 'рейтинг RTTF до 300');
  });
});
