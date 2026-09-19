import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chargeOf, moneyOf, type ChargeRow } from './revenue.ts';

const row = (over: Partial<ChargeRow> = {}): ChargeRow => ({
  price: 80_000,
  status: 'BOOKED',
  chargeRatio: null,
  ...over,
});

describe('chargeOf', () => {
  it('за активную и состоявшуюся запись начисляется полная цена', () => {
    assert.equal(chargeOf(row({ status: 'BOOKED' })), 80_000);
    assert.equal(chargeOf(row({ status: 'ATTENDED', chargeRatio: 100 })), 80_000);
  });

  it('ранняя отмена без зафиксированного процента не приносит ничего', () => {
    assert.equal(chargeOf(row({ status: 'CANCELLED', chargeRatio: null })), 0);
    assert.equal(chargeOf(row({ status: 'CANCELLED', chargeRatio: 0 })), 0);
  });

  it('поздняя отмена приносит зафиксированный процент', () => {
    assert.equal(chargeOf(row({ status: 'CANCELLED', chargeRatio: 50 })), 40_000);
    assert.equal(chargeOf(row({ status: 'CANCELLED', chargeRatio: 100 })), 80_000);
  });

  it('запись по абонементу денег дня не приносит ни в каком исходе', () => {
    // Деньги пришли продажей абонемента, а процент у такой записи — судьба
    // визита: 100 у сгоревшего значит «визит израсходован», а не «вся цена».
    for (const status of ['BOOKED', 'ATTENDED', 'NO_SHOW', 'CANCELLED'] as const) {
      assert.equal(chargeOf(row({ status, chargeRatio: 100, prepaid: true })), 0);
    }
  });

  /**
   * Без процента бывают только строки, отмеченные до появления отметки в
   * продукте. Обнулить их здесь значило бы терять деньги молча.
   */
  it('отметка без проставленного процента считается полной', () => {
    assert.equal(chargeOf(row({ status: 'NO_SHOW', chargeRatio: null })), 80_000);
    assert.equal(chargeOf(row({ status: 'ATTENDED', chargeRatio: null })), 80_000);
  });

  it('неявка с процентом считается по нему', () => {
    assert.equal(chargeOf(row({ status: 'NO_SHOW', chargeRatio: 100 })), 80_000);
    assert.equal(chargeOf(row({ status: 'NO_SHOW', chargeRatio: 50 })), 40_000);
  });

  it('прощённая неявка не приносит ничего', () => {
    assert.equal(chargeOf(row({ status: 'NO_SHOW', chargeRatio: 0 })), 0);
  });

  it('присутствие считается по снятому проценту', () => {
    assert.equal(chargeOf(row({ status: 'ATTENDED', chargeRatio: 100 })), 80_000);
  });

  it('процент округляется до целой копейки', () => {
    // 70 000 × 33% = 23 100 ровно; 70 001 × 33% = 23 100,33 — дробь в деньгах
    // недопустима, схема хранит целые копейки.
    assert.equal(chargeOf(row({ price: 70_001, status: 'CANCELLED', chargeRatio: 33 })), 23_100);
    assert.equal(Number.isInteger(chargeOf(row({ price: 33_333, status: 'NO_SHOW', chargeRatio: 50 }))), true);
  });
});

describe('moneyOf', () => {
  it('складывает три вида услуг и даёт итог', () => {
    const money = moneyOf({
      tables: [row({ price: 80_000 }), row({ price: 120_000 })],
      trainings: [row({ price: 70_000 })],
      tournaments: [row({ price: 50_000 }), row({ price: 50_000 })],
    });

    assert.equal(money.tables, 200_000);
    assert.equal(money.trainings, 70_000);
    assert.equal(money.tournaments, 100_000);
    assert.equal(money.total, 370_000);
  });

  it('пустой день не даёт ни денег, ни людей', () => {
    const money = moneyOf({ tables: [], trainings: [], tournaments: [] });

    assert.deepEqual(money, {
      tables: 0,
      trainings: 0,
      tournaments: 0,
      total: 0,
      count: 0,
      cancelled: 0,
    });
  });

  /**
   * Число визитов и деньги считаются по разным правилам, и это не оплошность:
   * поздняя отмена приносит клубу деньги, но человека в зале не даёт.
   */
  it('отменённая запись даёт деньги, но не даёт визита', () => {
    const money = moneyOf({
      tables: [row({ price: 80_000, status: 'CANCELLED', chargeRatio: 50 })],
      trainings: [],
      tournaments: [],
    });

    assert.equal(money.total, 40_000);
    assert.equal(money.cancelled, 40_000);
    assert.equal(money.count, 0);
  });

  it('в число визитов идут только записанные и пришедшие', () => {
    const money = moneyOf({
      tables: [row({ status: 'BOOKED' }), row({ status: 'NO_SHOW', chargeRatio: 100 })],
      trainings: [row({ status: 'ATTENDED' }), row({ status: 'CANCELLED', chargeRatio: 0 })],
      tournaments: [],
    });

    assert.equal(money.count, 2);
  });

  it('списания по отменам входят в итог, а не стоят рядом с ним', () => {
    const money = moneyOf({
      tables: [row({ price: 80_000 }), row({ price: 80_000, status: 'CANCELLED', chargeRatio: 50 })],
      trainings: [],
      tournaments: [],
    });

    assert.equal(money.cancelled, 40_000);
    assert.equal(money.total, 120_000);
  });
});
