import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { billedHalfHours, quote, tablePrice, type HallPricing } from './pricing.ts';

/** Прайс «Енисея» из ТЗ, в копейках. */
const YENISEY: HallPricing = {
  tableHourPrice: 40_000,
  tableExtra30MinPrice: 20_000,
  hasRobotOption: true,
  robot30MinPrice: 60_000,
  robot60MinPrice: 90_000,
  robotExtra30MinPrice: 30_000,
};

describe('billedHalfHours', () => {
  it('считает начатые получасы полными', () => {
    assert.equal(billedHalfHours(31, 1), 2);
    assert.equal(billedHalfHours(59, 1), 2);
    assert.equal(billedHalfHours(60, 1), 2);
    assert.equal(billedHalfHours(61, 1), 3);
  });

  it('не опускается ниже минимума прайса', () => {
    assert.equal(billedHalfHours(10, 2), 2);
    assert.equal(billedHalfHours(30, 2), 2);
  });
});

describe('аренда стола без робота', () => {
  it('час стоит цену часа', () => {
    assert.equal(tablePrice(YENISEY, 60, false), 40_000);
  });

  it('короче часа тарифицируется как час: ниже прайс не спускается', () => {
    assert.equal(tablePrice(YENISEY, 30, false), 40_000);
    assert.equal(tablePrice(YENISEY, 10, false), 40_000);
  });

  it('каждые следующие полчаса — доплата', () => {
    assert.equal(tablePrice(YENISEY, 90, false), 60_000);
    assert.equal(tablePrice(YENISEY, 120, false), 80_000);
    assert.equal(tablePrice(YENISEY, 180, false), 120_000);
  });

  it('начатые полчаса считаются полными', () => {
    // Зал с шагом 20 минут: 80 минут — это час и начатые полчаса.
    assert.equal(tablePrice(YENISEY, 80, false), 60_000);
    // Ровно те же деньги, что за 90 минут: клиент доплачивает за начатый
    // интервал, а не за минуты.
    assert.equal(tablePrice(YENISEY, 80, false), tablePrice(YENISEY, 90, false));
  });
});

describe('аренда стола с роботом', () => {
  it('идёт по своей сетке цен, а не наценкой поверх обычной', () => {
    assert.equal(tablePrice(YENISEY, 30, true), 60_000);
    assert.equal(tablePrice(YENISEY, 60, true), 90_000);
    // Час с роботом — не два получаса: 900 ₽, а не 1200 ₽.
    assert.notEqual(tablePrice(YENISEY, 60, true), 2 * 60_000);
  });

  it('дальше часа — доплата за каждые полчаса', () => {
    assert.equal(tablePrice(YENISEY, 90, true), 120_000);
    assert.equal(tablePrice(YENISEY, 120, true), 150_000);
  });

  it('начатые полчаса считаются полными', () => {
    // 40 минут — это начатый второй получас, то есть цена часа.
    assert.equal(tablePrice(YENISEY, 40, true), 90_000);
  });

  it('в зале без робота цену взять неоткуда', () => {
    const noRobot: HallPricing = { ...YENISEY, hasRobotOption: false };

    assert.throws(() => tablePrice(noRobot, 60, true), /нет аренды с роботом/);
  });

  it('включённая опция без заполненных цен — тоже отказ, а не даровой робот', () => {
    const broken: HallPricing = { ...YENISEY, robot60MinPrice: null };

    assert.throws(() => tablePrice(broken, 60, true), /нет аренды с роботом/);
  });
});

describe('quote', () => {
  it('показывает, за сколько минут посчитана цена', () => {
    assert.deepEqual(quote(YENISEY, 80, false), {
      durationMinutes: 80,
      billedMinutes: 90,
      price: 60_000,
    });
  });

  it('получасовая аренда без робота оплачивается как час', () => {
    assert.deepEqual(quote(YENISEY, 30, false), {
      durationMinutes: 30,
      billedMinutes: 60,
      price: 40_000,
    });
  });

  it('с роботом минимум — полчаса, а не час', () => {
    assert.deepEqual(quote(YENISEY, 30, true), {
      durationMinutes: 30,
      billedMinutes: 30,
      price: 60_000,
    });
  });
});
