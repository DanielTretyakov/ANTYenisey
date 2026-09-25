/**
 * Адрес зала — только настоящий (решение владельца от 25.09.2026): его
 * выбирают из подсказок DaData, а при сохранении сервер заново находит дом по
 * коду ФИАС и пишет адрес из ответа справочника, а не из формы.
 *
 * Чистый модуль без относительных импортов — его гоняет `node --test`.
 */

/** Подсказка DaData — только те поля, что нам нужны. */
export interface DadataSuggestion {
  value: string;
  data: {
    fias_id?: string | null;
    house_fias_id?: string | null;
    house?: string | null;
    city?: string | null;
    settlement?: string | null;
    geo_lat?: string | null;
    geo_lon?: string | null;
  };
}

/** Дом из справочника. */
export interface FoundAddress {
  value: string;
  fiasId: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
}

export type AddressCheck = { ok: true; address: FoundAddress } | { ok: false; message: string };

/**
 * Подсказку — в дом, или ничего.
 *
 * Улица без номера дома — не адрес зала: «ул. Ленина» в Красноярске тянется
 * на несколько километров. Код берётся дома, а не улицы: по коду улицы
 * `findById` потом вернул бы саму улицу.
 */
export function toFoundAddress(suggestion: DadataSuggestion): FoundAddress | null {
  const { data } = suggestion;
  const fiasId = data.house_fias_id || data.fias_id;

  if (!data.house || !fiasId || !suggestion.value.trim()) {
    return null;
  }

  const latitude = coordinate(data.geo_lat, 90);
  const longitude = coordinate(data.geo_lon, 180);
  // Координаты — парой: одна без другой на карту не встанет.
  const pair = latitude !== null && longitude !== null;

  return {
    value: suggestion.value.trim(),
    fiasId,
    city: data.city || data.settlement || null,
    latitude: pair ? latitude : null,
    longitude: pair ? longitude : null,
  };
}

function coordinate(raw: string | null | undefined, limit: number): number | null {
  if (!raw) {
    return null;
  }

  const value = Number(raw);

  return Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

/**
 * Один ли это город: без регистра, «ё» = «е», без приставки «г».
 * Справочник платформы пишет «Красноярск», DaData — тоже, но «Королёв» и
 * «Королев» встречаются в обоих вариантах.
 */
export function sameCity(a: string, b: string): boolean {
  const norm = (value: string): string =>
    value
      .toLowerCase()
      .replaceAll('ё', 'е')
      .replace(/^г\.?\s+/, '')
      .trim();

  return norm(a) === norm(b);
}

/**
 * Можно ли записать найденный дом залу.
 *
 * Город зала задан справочником платформы, и адрес обязан лежать в нём:
 * иначе поиск по городу нашёл бы клуб в Красноярске, а ехать пришлось бы в
 * Абакан. Город неизвестен с одной из сторон — не спорим.
 */
export function checkAddress(found: FoundAddress | null, hallCity: string | null): AddressCheck {
  if (!found) {
    return { ok: false, message: 'Адрес не найден в справочнике — выберите дом из подсказок' };
  }

  if (hallCity && found.city && !sameCity(found.city, hallCity)) {
    return { ok: false, message: `Адрес в городе ${found.city}, а зал — в городе ${hallCity}` };
  }

  return { ok: true, address: found };
}
