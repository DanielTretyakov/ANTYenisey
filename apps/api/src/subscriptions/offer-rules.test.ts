import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickOffers, type OfferPlan } from './offer-rules.ts';

const plan = (id: string, name: string, visitsCount: number | null, price: number, covers = [name]): OfferPlan => ({
  id,
  name,
  visitsCount,
  durationDays: null,
  price,
  covers,
});

describe('pickOffers', () => {
  const kids = [8, 12, 16, 20, 30, 45, 60].map((visits, index) => plan(`k${visits}`, 'Детский', visits, 4000 + index * 1500));
  const adult = [plan('a8', 'Взрослый', 8, 6000), plan('a16', 'Взрослый', 16, 11000)];
  const cup = [plan('c4', 'Турниры', 4, 3000)];

  it('сначала по одному тарифу каждого вида — самый доступный вход', () => {
    const picked = pickOffers([...kids, ...adult, ...cup], 3);
    assert.deepEqual(picked.map((item) => item.id).sort(), ['a8', 'c4', 'k8']);
  });

  it('оставшиеся места — самые большие пакеты, не соседние', () => {
    const picked = pickOffers([...kids, ...adult, ...cup], 5);
    assert.deepEqual(picked.map((item) => item.id), ['c4', 'k8', 'k60', 'a8', 'a16']);
  });

  it('один вид — вход, самый большой и середина, без повторов', () => {
    assert.deepEqual(pickOffers(kids, 3).map((item) => item.id), ['k8', 'k20', 'k60']);
  });

  it('тарифов меньше предела — все', () => {
    assert.equal(pickOffers(cup).length, 1);
    assert.deepEqual(pickOffers([]), []);
  });

  it('безлимит — самый большой пакет вида', () => {
    const picked = pickOffers([plan('u', 'Детский', null, 20000), ...kids], 2);
    assert.deepEqual(picked.map((item) => item.id), ['k8', 'u']);
  });

  it('одно название с разным покрытием — разные виды', () => {
    const picked = pickOffers([plan('x', 'Абонемент', 8, 5000, ['Детская']), plan('y', 'Абонемент', 8, 5000, ['Взрослая'])], 2);
    assert.equal(picked.length, 2);
  });
});
