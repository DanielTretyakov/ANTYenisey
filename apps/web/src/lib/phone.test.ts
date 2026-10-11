import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatPhone } from './phone.ts';

describe('formatPhone', () => {
  it('российский номер — блоками, как в поле ввода', () => {
    assert.equal(formatPhone('+73912000000'), '+7 391 200-00-00');
  });

  it('непохожее — как есть', () => {
    assert.equal(formatPhone('+375291234567'), '+375291234567');
    assert.equal(formatPhone('8 391 200'), '8 391 200');
  });
});
