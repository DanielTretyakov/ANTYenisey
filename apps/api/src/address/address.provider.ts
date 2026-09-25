import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { sameCity, toFoundAddress, type DadataSuggestion, type FoundAddress } from './address-rules';

const API = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs';

/**
 * Справочник адресов.
 *
 * Абстрактный класс, а не интерфейс: он же служит токеном внедрения, как
 * `MaxTransport`. Настоящий ходит в DaData, поддельный отвечает несколькими
 * домами для разработки и смоука, выключенный честно говорит «недоступно».
 */
export abstract class AddressProvider {
  /** live — DaData; fake — разработка без ключа; off — production без ключа. */
  abstract readonly mode: 'live' | 'fake' | 'off';

  /** Дома по началу адреса, в пределах города зала, если он известен. */
  abstract suggest(query: string, city: string | null): Promise<FoundAddress[]>;

  /** Дом по коду ФИАС — перепроверка при сохранении зала. */
  abstract findById(fiasId: string): Promise<FoundAddress | null>;
}

const UNAVAILABLE = 'Справочник адресов сейчас недоступен — попробуйте позже';

/** DaData: бесплатно до 10 000 запросов в сутки, ключ — `DADATA_API_KEY`. */
export class DadataAddressProvider extends AddressProvider {
  readonly mode = 'live' as const;
  private readonly logger = new Logger('DaData');

  constructor(private readonly apiKey: string) {
    super();
  }

  async suggest(query: string, city: string | null): Promise<FoundAddress[]> {
    const suggestions = await this.call('suggest/address', {
      query,
      count: 10,
      ...(city ? { locations: [{ city }], restrict_value: true } : {}),
      from_bound: { value: 'street' },
      to_bound: { value: 'house' },
    });

    return suggestions.map(toFoundAddress).filter((item): item is FoundAddress => item !== null);
  }

  async findById(fiasId: string): Promise<FoundAddress | null> {
    const [first] = await this.call('findById/address', { query: fiasId, count: 1 });

    return first ? toFoundAddress(first) : null;
  }

  private async call(path: string, body: object): Promise<DadataSuggestion[]> {
    let response: Response;

    try {
      response = await fetch(`${API}/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Token ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      });
    } catch (error) {
      this.logger.warn(`DaData не ответила: ${(error as Error).message}`);
      throw new ServiceUnavailableException(UNAVAILABLE);
    }

    if (!response.ok) {
      // 403 — неверный ключ или кончился суточный лимит: человеку это не
      // исправить, а администратору платформы видно в журнале.
      this.logger.warn(`DaData ответила ${response.status} на ${path}`);
      throw new ServiceUnavailableException(UNAVAILABLE);
    }

    const payload = (await response.json()) as { suggestions?: DadataSuggestion[] };

    return payload.suggestions ?? [];
  }
}

/**
 * Поддельный справочник — вне production и без ключа: разработка и смоук в CI
 * работают без DaData. Коды с приставкой `fake-` настоящий справочник не
 * узнает — зал, сохранённый так, на стенд не переедет.
 */
export class FakeAddressProvider extends AddressProvider {
  readonly mode = 'fake' as const;

  static readonly HOUSES: FoundAddress[] = [
    house('Красноярск', 'ул Партизана Железняка, д 25', 'fake-krs-zheleznyaka-25', 56.0306, 92.908),
    house('Красноярск', 'пр-кт Мира, д 10', 'fake-krs-mira-10', 56.0128, 92.8703),
    house('Красноярск', 'ул Ленина, д 113', 'fake-krs-lenina-113', 56.0152, 92.8665),
    house('Красноярск', 'ул Ленина, д 21', 'fake-krs-lenina-21', 56.0089, 92.8903),
    house('Абакан', 'ул Щетинкина, д 12', 'fake-abakan-shchetinkina-12', 53.7222, 91.4424),
    house('Минусинск', 'ул Гоголя, д 7', 'fake-minusinsk-gogolya-7', 53.7106, 91.6874),
  ];

  async suggest(query: string, city: string | null): Promise<FoundAddress[]> {
    const words = query.toLowerCase().replaceAll('ё', 'е').split(/[\s,.]+/).filter(Boolean);

    return FakeAddressProvider.HOUSES.filter(
      (item) =>
        (!city || (item.city !== null && sameCity(item.city, city))) &&
        words.every((word) => item.value.toLowerCase().replaceAll('ё', 'е').includes(word)),
    );
  }

  async findById(fiasId: string): Promise<FoundAddress | null> {
    return FakeAddressProvider.HOUSES.find((item) => item.fiasId === fiasId) ?? null;
  }
}

/** Production без ключа: адрес зала не выбрать и не сохранить. */
export class DisabledAddressProvider extends AddressProvider {
  readonly mode = 'off' as const;

  suggest(): Promise<FoundAddress[]> {
    throw new ServiceUnavailableException('Подсказки адресов не подключены: не задан DADATA_API_KEY');
  }

  findById(): Promise<FoundAddress | null> {
    throw new ServiceUnavailableException('Подсказки адресов не подключены: не задан DADATA_API_KEY');
  }
}

function house(city: string, street: string, fiasId: string, latitude: number, longitude: number): FoundAddress {
  return { value: `г ${city}, ${street}`, fiasId, city, latitude, longitude };
}
