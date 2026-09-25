import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkAddress, sameCity, toFoundAddress, type DadataSuggestion } from './address-rules.ts';

const house: DadataSuggestion = {
  value: 'г Красноярск, ул Партизана Железняка, д 25',
  data: {
    fias_id: 'house-1',
    house_fias_id: 'house-1',
    house: '25',
    city: 'Красноярск',
    geo_lat: '56.0306',
    geo_lon: '92.908',
  },
};

describe('toFoundAddress', () => {
  it('дом — с кодом, городом и координатами', () => {
    assert.deepEqual(toFoundAddress(house), {
      value: 'г Красноярск, ул Партизана Железняка, д 25',
      fiasId: 'house-1',
      city: 'Красноярск',
      latitude: 56.0306,
      longitude: 92.908,
    });
  });

  it('улица без дома — не адрес зала', () => {
    assert.equal(toFoundAddress({ value: 'г Красноярск, ул Ленина', data: { fias_id: 'street', house: null } }), null);
  });

  it('без кода ФИАС — не из справочника', () => {
    assert.equal(toFoundAddress({ value: 'ул. Крутых Ключей, 777', data: { house: '777' } }), null);
  });

  it('код дома важнее кода улицы', () => {
    const found = toFoundAddress({ ...house, data: { ...house.data, fias_id: 'street', house_fias_id: 'house-2' } });
    assert.equal(found?.fiasId, 'house-2');
  });

  it('посёлок вместо города', () => {
    const found = toFoundAddress({ ...house, data: { ...house.data, city: null, settlement: 'Солонцы' } });
    assert.equal(found?.city, 'Солонцы');
  });

  it('координаты — парой или никак', () => {
    const found = toFoundAddress({ ...house, data: { ...house.data, geo_lon: 'мусор' } });
    assert.equal(found?.latitude, null);
    assert.equal(found?.longitude, null);
  });
});

describe('checkAddress', () => {
  const found = toFoundAddress(house);

  it('дом в городе зала', () => {
    assert.equal(checkAddress(found, 'Красноярск').ok, true);
  });

  it('ничего не нашлось', () => {
    assert.equal(checkAddress(null, 'Красноярск').ok, false);
  });

  it('дом в другом городе', () => {
    const result = checkAddress(found, 'Абакан');
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.message, /Абакан/);
  });

  it('город зала не задан — не спорим', () => {
    assert.equal(checkAddress(found, null).ok, true);
  });
});

describe('sameCity', () => {
  it('ё и е, регистр, приставка', () => {
    assert.equal(sameCity('Королёв', 'королев'), true);
    assert.equal(sameCity('г Красноярск', 'Красноярск'), true);
    assert.equal(sameCity('Красноярск', 'Абакан'), false);
  });
});
