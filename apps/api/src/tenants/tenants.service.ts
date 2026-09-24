import { Injectable, NotFoundException } from '@nestjs/common';
import type { City, ClubCard, ClubSearchQuery, CitySearchQuery, PublicTenant } from '@yenisey/types';
import { cityLimit, cityPatterns } from './city-search';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Поля клуба, из которых собирается карточка. Города берутся и у клуба, и у
 * залов: поиск находит клуб по совпадению любого из них, и выдача, где город
 * запроса нигде не показан, выглядела бы ошибкой.
 */
const CARD_SELECT = {
  slug: true,
  name: true,
  logoUrl: true,
  accentColor: true,
  city: { select: { name: true } },
  halls: { select: { city: { select: { name: true } } } },
} as const;

const CITY_SELECT = { id: true, name: true, region: true } as const;

type CardRow = {
  slug: string;
  name: string;
  logoUrl: string | null;
  accentColor: string | null;
  city: { name: string } | null;
  halls: { city: { name: string } | null }[];
};

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Подсказки города из справочника платформы — все города РФ.
   *
   * Открыт без авторизации: он нужен поиску на стартовой странице, куда
   * человек попадает до всякого входа. Правила совпадения — `cityPatterns`.
   */
  async searchCities(query: CitySearchQuery): Promise<City[]> {
    const limit = cityLimit(query.limit);
    const patterns = cityPatterns(query.query);

    // Без запроса — самые крупные: у пустого поля подсказка должна что-то
    // предлагать. Население пусто у городов вне справочника — они в конце.
    if (!patterns) {
      return this.prisma.city.findMany({
        select: CITY_SELECT,
        orderBy: [{ population: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
        take: limit,
      });
    }

    // Сырой запрос ради порядка: совпавшие началом названия — раньше
    // совпавших началом слова, внутри — по населению. Prisma такой сортировки
    // по условию не выражает. lower(name) — под индекс City_name_lower_idx.
    return this.prisma.$queryRaw<City[]>`
      SELECT id, name, region
      FROM "City"
      WHERE lower(name) LIKE ${patterns.prefix}
         OR lower(name) LIKE ${patterns.word}
         OR lower(name) LIKE ${patterns.hyphen}
      ORDER BY (lower(name) LIKE ${patterns.prefix}) DESC, population DESC NULLS LAST, name
      LIMIT ${limit}
    `;
  }

  async findCity(id: string): Promise<City> {
    const city = await this.prisma.city.findUnique({ where: { id }, select: CITY_SELECT });

    if (!city) {
      throw new NotFoundException('Город не найден');
    }

    return city;
  }

  /**
   * Поиск клубов по названию и городу.
   *
   * **Город совпадает, если это город клуба ИЛИ город хотя бы одного его
   * зала** (ТЗ → «Профиль клуба»). Иначе клуб с залами в Красноярске и Абакане
   * нашёлся бы только по одному из них, и перенос часового пояса в зал потерял
   * бы смысл.
   *
   * Пустой запрос — не ошибка, а «покажи всё»: человек, открывший стартовую
   * страницу, ещё ничего не ввёл, и пустая выдача была бы ему бесполезна.
   */
  async search(query: ClubSearchQuery): Promise<ClubCard[]> {
    const name = query.query?.trim();

    const tenants = await this.prisma.tenant.findMany({
      where: {
        ...(name
          ? // insensitive, а не lower() руками: клуб ищут по обрывку названия,
            // и «енисей» обязано находить «АНТ «Енисей»».
            { name: { contains: name, mode: 'insensitive' as const } }
          : {}),
        ...(query.cityId
          ? { OR: [{ cityId: query.cityId }, { halls: { some: { cityId: query.cityId } } }] }
          : {}),
      },
      select: CARD_SELECT,
      orderBy: { name: 'asc' },
      // Верхняя граница, чтобы выдача не выросла в страницу на тысячу строк,
      // когда клубов станет много. Постраничность появится вместе с ними.
      take: 60,
    });

    return tenants.map(toCard);
  }

  /**
   * Карточка клуба по его коду. Открыто без авторизации: клуб выбирают до
   * того, как заводят учётку.
   *
   * Вместе с карточкой едут контакты и залы с ценами — то, ради чего человек
   * на страницу клуба и приходит: куда ехать, кому звонить и почём стол. До
   * 21.09.2026 здесь не было ничего, кроме названия и города, и посетитель
   * упирался в тупик.
   *
   * Настроек клуба и статуса подписки здесь по-прежнему нет. Часового пояса
   * тоже: он свойство зала, и форме брони приезжает вместе с залом.
   */
  async findPublicBySlug(slug: string): Promise<PublicTenant> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: {
        ...CARD_SELECT,
        phone: true,
        email: true,
        halls: {
          select: {
            id: true,
            name: true,
            address: true,
            tableHourPrice: true,
            tableExtra30MinPrice: true,
            hasRobotOption: true,
            robot60MinPrice: true,
            city: { select: { name: true } },
            _count: { select: { tables: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException('Клуб не найден');
    }

    const card = toCard(tenant);

    return {
      slug: card.slug,
      name: card.name,
      city: card.city,
      otherCities: card.otherCities,
      logoUrl: card.logoUrl,
      accentColor: card.accentColor,
      phone: tenant.phone,
      email: tenant.email,
      halls: tenant.halls.map((hall) => ({
        id: hall.id,
        name: hall.name,
        city: hall.city?.name ?? null,
        address: hall.address,
        tableHourPrice: hall.tableHourPrice,
        tableExtra30MinPrice: hall.tableExtra30MinPrice,
        // Час с роботом показывается только там, где робот есть: цена без
        // услуги читалась бы как «доплатите и получите».
        robotHourPrice: hall.hasRobotOption ? hall.robot60MinPrice : null,
        tables: hall._count.tables,
      })),
    };
  }
}

/**
 * Строка базы в карточку.
 *
 * Города залов, совпадающие с основным, отбрасываются: «Красноярск ·
 * Красноярск» в карточке клуба с двумя залами в одном городе читается как
 * ошибка вёрстки.
 */
function toCard(row: CardRow): ClubCard {
  const city = row.city?.name ?? null;

  const otherCities = [
    ...new Set(
      row.halls
        .map((hall) => hall.city?.name)
        .filter((name): name is string => name !== undefined && name !== null && name !== city),
    ),
  ].sort();

  return {
    slug: row.slug,
    name: row.name,
    logoUrl: row.logoUrl,
    accentColor: row.accentColor,
    city,
    otherCities,
    hallCount: row.halls.length,
  };
}
