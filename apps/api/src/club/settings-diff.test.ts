import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CLUB_DEFERRED_FIELDS,
  changedFields,
  defaultTableLabels,
  effectiveLabel,
  hallChanges,
  hallCreatedLines,
  nextDate,
} from './settings-diff.ts';

const hall = {
  name: 'Пироги',
  address: 'г Красноярск, ул Ленина, д 1',
  addressFiasId: 'a1',
  latitude: 56,
  longitude: 92,
  tableHourPrice: 40000,
  bookingStep: 'MIN_30',
  hasRobotOption: false,
  robot30MinPrice: null,
  phone: null,
};

describe('changedFields', () => {
  it('пересохранённая форма без правок — ничего', () => {
    const result = hallChanges(hall, { ...hall });
    assert.deepEqual(result.data, {});
    assert.deepEqual(result.lines, []);
  });

  it('неприсланное поле не трогается', () => {
    assert.deepEqual(hallChanges(hall, { name: undefined }).data, {});
  });

  it('деньги — рублями с пробелом, шаг — словами', () => {
    const result = hallChanges(hall, { ...hall, tableHourPrice: 450000, bookingStep: 'HOUR_1' });
    assert.deepEqual(result.data, { tableHourPrice: 450000, bookingStep: 'HOUR_1' });
    assert.deepEqual(result.lines, ['Шаг брони: 30 минут → час', 'Час аренды: 400 ₽ → 4 500 ₽']);
  });

  it('пустое — «не задано», null и отсутствие равны', () => {
    const result = hallChanges(hall, { phone: '+79990000000' });
    assert.deepEqual(result.lines, ['Телефон: не задано → «+79990000000»']);
    assert.deepEqual(hallChanges({ ...hall, email: undefined }, { email: null }).data, {});
  });

  it('код дома и координаты едут с адресом без своих строк', () => {
    const result = hallChanges(hall, { address: 'г Красноярск, ул Мира, д 2', addressFiasId: 'a2', latitude: 57 });
    assert.deepEqual(result.data, { address: 'г Красноярск, ул Мира, д 2', addressFiasId: 'a2', latitude: 57 });
    assert.equal(result.lines.length, 1);
  });

  it('город — названием, флаг — да/нет, процент', () => {
    const result = changedFields(
      CLUB_DEFERRED_FIELDS,
      { cityId: 'c1', subscriptionBurnsOnNoShowOnly: false, noShowChargePercent: 50 },
      { cityId: 'c2', subscriptionBurnsOnNoShowOnly: true, noShowChargePercent: 100 },
      { c1: 'Красноярск', c2: 'Ачинск' },
    );
    assert.deepEqual(result.lines, [
      'Город: Красноярск → Ачинск',
      'Списание за неявку: 50 % → 100 %',
      'Визит абонемента сгорает только при неявке: нет → да',
    ]);
  });

  it('оформление страницы в отложенные поля клуба не входит', () => {
    const result = changedFields(CLUB_DEFERRED_FIELDS, { description: 'а' }, { description: 'б', accentColor: '#000' });
    assert.deepEqual(result.data, {});
  });
});

describe('новый зал', () => {
  it('сводка и столы', () => {
    assert.deepEqual(hallCreatedLines({ name: 'Баки', address: null, tableHourPrice: 50000, tableCount: 2 }), [
      'Новый зал «Баки»',
      'Адрес: не задан',
      'Час аренды: 500 ₽',
      'Столов: 2',
    ]);
    assert.deepEqual(defaultTableLabels(3), ['Стол 1', 'Стол 2', 'Стол 3']);
    assert.deepEqual(defaultTableLabels(0), []);
  });
});

describe('полночь', () => {
  it('следующий день, в том числе через месяц и год', () => {
    assert.equal(nextDate('2026-09-26'), '2026-09-27');
    assert.equal(nextDate('2026-09-30'), '2026-10-01');
    assert.equal(nextDate('2026-12-31'), '2027-01-01');
  });

  it('подпись', () => {
    assert.equal(effectiveLabel('2026-09-27'), '27 сентября в 00:00');
  });
});
