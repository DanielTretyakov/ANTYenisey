import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatKopecks, inputToKopecks, kopecksToInput } from './money.ts';

describe('kopecksToInput', () => {
  it('круглые суммы показывает без копеек', () => {
    assert.equal(kopecksToInput(40_000), '400');
    assert.equal(kopecksToInput(0), '0');
  });

  it('дробную часть дополняет до двух знаков', () => {
    assert.equal(kopecksToInput(40_050), '400,50');
    assert.equal(kopecksToInput(40_005), '400,05');
  });
});

describe('formatKopecks', () => {
  it('добавляет знак рубля', () => {
    assert.equal(formatKopecks(40_000), '400 ₽');
    assert.equal(formatKopecks(40_050), '400,50 ₽');
  });
});

describe('inputToKopecks', () => {
  it('целые рубли переводит в копейки', () => {
    assert.equal(inputToKopecks('400'), 40_000);
    assert.equal(inputToKopecks('0'), 0);
  });

  it('принимает и запятую, и точку', () => {
    assert.equal(inputToKopecks('400,50'), 40_050);
    assert.equal(inputToKopecks('400.50'), 40_050);
  });

  it('один знак после разделителя — это десятки копеек', () => {
    // «400,5» — это 400 рублей 50 копеек, а не 5 копеек.
    assert.equal(inputToKopecks('400,5'), 40_050);
  });

  it('не теряет копейку на числах, где плавающая точка ошибается', () => {
    // 19.99 * 100 в двоичной плавающей точке даёт 1998.9999999999998.
    assert.equal(inputToKopecks('19,99'), 1_999);
    assert.equal(inputToKopecks('1234,56'), 123_456);
  });

  it('терпит пробелы, которыми номер приезжает из буфера обмена', () => {
    assert.equal(inputToKopecks(' 1 200 '), 120_000);
  });

  it('отклоняет мусор, пустую строку и лишние знаки', () => {
    assert.equal(inputToKopecks(''), null);
    assert.equal(inputToKopecks('   '), null);
    assert.equal(inputToKopecks('бесплатно'), null);
    assert.equal(inputToKopecks('400,555'), null);
    assert.equal(inputToKopecks('-400'), null);
    assert.equal(inputToKopecks('4,0,0'), null);
  });
});
