import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashToken, parseDuration } from './tokens.ts';

describe('parseDuration', () => {
  it('разбирает все поддерживаемые единицы', () => {
    assert.equal(parseDuration('45s'), 45_000);
    assert.equal(parseDuration('15m'), 900_000);
    assert.equal(parseDuration('12h'), 43_200_000);
    assert.equal(parseDuration('30d'), 2_592_000_000);
  });

  it('терпит пробелы по краям', () => {
    assert.equal(parseDuration('  15m  '), 900_000);
  });

  it('падает на мусоре, а не возвращает NaN', () => {
    // Молчаливый NaN здесь означал бы expiresAt = Invalid Date, то есть
    // refresh-токен без срока годности.
    for (const bad of ['', '15', 'm', '15min', '-5m', '1.5h', '15 m']) {
      assert.throws(() => parseDuration(bad), /Некорректная длительность/, `принял «${bad}»`);
    }
  });
});

describe('hashToken', () => {
  it('даёт стабильный SHA-256 в hex', () => {
    assert.equal(
      hashToken('токен'),
      hashToken('токен'),
      'один вход должен давать один хеш',
    );
    assert.match(hashToken('токен'), /^[0-9a-f]{64}$/);
  });

  it('различает разные токены', () => {
    assert.notEqual(hashToken('a'), hashToken('b'));
  });
});
