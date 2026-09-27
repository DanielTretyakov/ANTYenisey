import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSparringType, sparringAgeProblem, sparringPrice } from './sparring-rules.ts';

describe('sparringPrice', () => {
  it('пропорционально длительности, до копейки', () => {
    assert.equal(sparringPrice(150_000, 60), 150_000);
    assert.equal(sparringPrice(150_000, 90), 225_000);
    assert.equal(sparringPrice(100_001, 30), 50_001);
  });
});

describe('sparringAgeProblem', () => {
  const kids = { name: 'Детский', minAge: null, maxAge: 13 };
  const adults = { name: 'Взрослый', minAge: 18, maxAge: null };
  const born = new Date('2012-10-10T00:00:00Z');

  it('возраст — на день спарринга, а не на сегодня', () => {
    assert.equal(sparringAgeProblem(kids, born, new Date('2026-10-09T12:00:00Z')), null);
    assert.match(sparringAgeProblem(kids, born, new Date('2026-10-10T12:00:00Z')) ?? '', /до 13 лет.*14/);
  });

  it('нижняя граница', () => {
    assert.match(sparringAgeProblem(adults, born, new Date('2026-10-10T12:00:00Z')) ?? '', /с 18 лет/);
    assert.equal(sparringAgeProblem(adults, new Date('2000-01-01T00:00:00Z'), new Date('2026-10-10T12:00:00Z')), null);
  });

  it('без пределов подходит всем', () => {
    assert.equal(sparringAgeProblem({ name: 'Льготный', minAge: null, maxAge: null }, born, new Date()), null);
  });
});

describe('parseSparringType', () => {
  it('чистит название и описание', () => {
    const parsed = parseSparringType({ name: '  Детский   спарринг ', hourPrice: 100_000, description: '  ' });

    assert.ok(parsed.ok);
    assert.equal(parsed.value.name, 'Детский спарринг');
    assert.equal(parsed.value.description, null);
    assert.equal(parsed.value.isActive, true);
  });

  it('«от» больше «до» и дробный возраст — отказ', () => {
    assert.equal(parseSparringType({ name: 'X', hourPrice: 1, minAge: 15, maxAge: 10 }).ok, false);
    assert.equal(parseSparringType({ name: 'X', hourPrice: 1, minAge: 1.5 }).ok, false);
  });

  it('пустое название и отрицательная цена — отказ', () => {
    assert.equal(parseSparringType({ name: '   ', hourPrice: 1 }).ok, false);
    assert.equal(parseSparringType({ name: 'X', hourPrice: -1 }).ok, false);
  });
});
