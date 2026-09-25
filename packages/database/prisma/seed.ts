/**
 * Наполнение базы данными «Енисея» из раздела «Прайс-лист» в docs/TZ.md.
 *
 * Зачем: регистрация клиента невозможна в пустой базе — она заводит человека
 * в конкретный клуб по его slug, и без строки Tenant форма входа отвечает
 * ошибкой. Это первое, что должно появиться в свежей базе разработчика.
 *
 * Скрипт идемпотентен (upsert по естественным ключам) — повторный запуск
 * ничего не дублирует и не затирает: цены, изменённые администратором в
 * админке, сид не откатывает.
 *
 * Сознательно НЕ заводит: абонементы (SubscriptionPlan), расписание
 * тренировок и турниры. Это данные, которые клуб заводит сам, и в каркасе
 * они ничего не проверяют.
 *
 * Запуск: pnpm --filter @yenisey/database seed
 */
// Путь оканчивается на /index.js, а не на каталог: скрипт запускается
// напрямую через node с нативным срезанием типов, то есть как ES-модуль, а
// тот не умеет достраивать /index к пути каталога.
import { PrismaClient, Role } from '../generated/client/index.js';

const prisma = new PrismaClient();

/** Все суммы — в копейках (сквозное правило схемы). 700 ₽ = 70000. */
const RUB = 100;

async function main(): Promise<void> {
  // Города заводятся первыми: на них ссылаются и клуб, и залы. Справочник —
  // все города РФ (prisma/data/cities-ru.json), заливка та же, что у
  // `pnpm db:seed-cities`. Путь импорта — переменной: проверка типов пакета
  // собрана под CommonJS и путь с расширением .ts не пропускает, а node без
  // расширения модуль не найдёт.
  const seedCitiesModule = './seed-cities.ts';
  const { seedCities } = (await import(seedCitiesModule)) as {
    seedCities: (client: PrismaClient) => Promise<{ created: number; updated: number }>;
  };
  const seeded = await seedCities(prisma);
  console.log(`Города: заведено ${seeded.created}, обновлено ${seeded.updated}.`);

  const cities = new Map<string, string>();

  // Города, на которые ссылаются демо-клубы. Регион указан: «Железногорск»
  // есть и в Красноярском крае, и в Курской области, и имени без региона
  // мало.
  for (const [name, region] of [
    ['Красноярск', 'Красноярский край'],
    ['Абакан', 'Республика Хакасия'],
    ['Минусинск', 'Красноярский край'],
  ] as const) {
    const row = await prisma.city.findFirst({ where: { name, region }, select: { id: true } });

    if (!row) {
      throw new Error(`Города «${name}» нет в справочнике`);
    }

    cities.set(name, row.id);
  }

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'yenisey' },
    update: {},
    create: {
      name: 'АНТ «Енисей»',
      slug: 'yenisey',
      // Часового пояса у клуба больше нет: он у каждого зала свой.
      cityId: cities.get('Красноярск')!,
      accentColor: '#126b54',
      // Знак академии больше не логотип продукта: у платформы свой,
      // векторный. Здесь он ровно то же, что логотип любого другого клуба, —
      // ссылка на картинку, которую клуб про себя заявил.
      logoUrl: '/brand/clubs/yenisey.png',
      // Контакты из ТЗ: по ним посетитель страницы клуба звонит и пишет.
      phone: '+73912000000',
      email: 'info@ant-yenisey.ru',
      noShowChargePercent: 100,
    },
  });

  // Долив новых полей в уже заведённый клуб.
  //
  // `update: {}` выше их не проставит: он для того и пуст, чтобы сид не
  // откатывал цены, изменённые администратором. Но город и фирменный цвет —
  // поля, которых у старых строк не было вовсе, и оставить их пустыми значит
  // не найти «Енисей» в поиске по Красноярску на своей же машине.
  //
  // Долив только там, где пусто: заполненное администратором значение сид не
  // трогает.
  await prisma.tenant.updateMany({
    where: { slug: 'yenisey', cityId: null },
    data: { cityId: cities.get('Красноярск')! },
  });

  await prisma.tenant.updateMany({
    where: { slug: 'yenisey', accentColor: null },
    data: { accentColor: '#126b54' },
  });

  await prisma.tenant.updateMany({
    where: { slug: 'yenisey', logoUrl: null },
    data: { logoUrl: '/brand/clubs/yenisey.png' },
  });

  await prisma.tenant.updateMany({
    where: { slug: 'yenisey', phone: null },
    data: { phone: '+73912000000' },
  });

  await prisma.tenant.updateMany({
    where: { slug: 'yenisey', email: null },
    data: { email: 'info@ant-yenisey.ru' },
  });

  // Цены, шаг брони и ЧАСОВОЙ ПОЯС живут у зала, а не у клуба: залы
  // различаются оборудованием, ценой и регионом.
  const hall = await prisma.hall.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'Основной зал' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Основной зал',
      timezone: 'Asia/Krasnoyarsk',
      cityId: cities.get('Красноярск')!,
      address: 'Красноярск, ул. Партизана Железняка, 25',
      // Адрес зала обязан прийти из справочника (CHECK Hall_address_verified).
      // У демо-данных кода ФИАС нет — заглушка с приставкой seed-, а
      // координат нет вовсе: ссылка «На карте» тогда ищет по тексту адреса.
      addressFiasId: 'seed-krasnoyarsk-partizana-zheleznyaka-25',
      hasRobotOption: true,
      tableHourPrice: 400 * RUB,
      tableExtra30MinPrice: 200 * RUB,
      robot30MinPrice: 600 * RUB,
      robot60MinPrice: 900 * RUB,
      robotExtra30MinPrice: 300 * RUB,
    },
  });

  // Тот же долив для залов: город у старых строк пуст, а без него клуб не
  // находится по городу зала — правило, которое ломается тише всего.
  await prisma.hall.updateMany({
    where: { tenantId: tenant.id, cityId: null },
    data: { cityId: cities.get('Красноярск')! },
  });

  // Политика отмены «как в такси» из ТЗ: отменил не позже чем за час — не
  // платит; отменил позже — половина; не пришёл и не отменил — полная
  // стоимость (это уже noShowChargePercent на клубе, не ступень).
  const tiers = [
    { minMinutesBeforeStart: 60, chargePercent: 0 },
    { minMinutesBeforeStart: 0, chargePercent: 50 },
  ];

  for (const tier of tiers) {
    await prisma.cancellationTier.upsert({
      where: {
        tenantId_minMinutesBeforeStart: {
          tenantId: tenant.id,
          minMinutesBeforeStart: tier.minMinutesBeforeStart,
        },
      },
      update: {},
      create: { tenantId: tenant.id, ...tier },
    });
  }

  const trainingTypes = [
    { name: 'Общая групповая тренировка', price: 700 * RUB },
    { name: 'Первая подача (для начинающих)', price: 600 * RUB },
    { name: 'Детская тренировка', price: 500 * RUB },
  ];

  for (const type of trainingTypes) {
    const existing = await prisma.trainingType.findFirst({
      where: { tenantId: tenant.id, name: type.name },
      select: { id: true },
    });

    if (!existing) {
      await prisma.trainingType.create({ data: { tenantId: tenant.id, ...type } });
    }
  }

  // Число в названии («Клуб 100») — справочное: система не проверяет рейтинг
  // и никого не отсекает, источника актуальных рейтингов пока нет.
  const tournamentTypes = [
    { name: 'Абсолют', ratingLabel: null },
    { name: 'Клуб 50', ratingLabel: '50' },
    { name: 'Клуб 100', ratingLabel: '100' },
    { name: 'Клуб 200', ratingLabel: '200' },
    { name: 'Клуб 300', ratingLabel: '300' },
    { name: 'Пятничное турне', ratingLabel: null },
  ];

  for (const type of tournamentTypes) {
    const existing = await prisma.tournamentType.findFirst({
      where: { tenantId: tenant.id, name: type.name },
      select: { id: true },
    });

    if (!existing) {
      await prisma.tournamentType.create({
        data: { tenantId: tenant.id, price: 700 * RUB, ...type },
      });
    }
  }

  // Количество столов клуб настраивает сам, добавляя и убирая строки Table.
  // Восемь — рабочее значение для локальной разработки, не факт из ТЗ:
  // реальное число столов «Енисея» уточняется у владельца.
  for (let index = 1; index <= 8; index += 1) {
    const label = `Стол ${index}`;

    await prisma.table.upsert({
      where: { hallId_label: { hallId: hall.id, label } },
      update: {},
      create: { tenantId: tenant.id, hallId: hall.id, label },
    });
  }

  // Администратор ищется по привязке к клубу, а не по учётной записи: роль теперь
  // свойство пары «человек + клуб», а не человека.
  const admin = await prisma.tenantMembership.findFirst({
    where: { tenantId: tenant.id, role: Role.ADMIN },
    select: { user: { select: { email: true } } },
  });

  await seedNeighbour(cities);

  console.log(`Клуб «${tenant.name}» (slug: ${tenant.slug}) готов.`);
  console.log(
    admin
      ? `Администратор уже заведён: ${admin.user.email}`
      : 'Администратор не заведён: создайте его отдельной командой — пароль не должен попадать в репозиторий.',
  );
}

/**
 * Второй клуб, в другом городе и с залом в третьем.
 *
 * Нужен не для красоты: без него нечем проверить ни поиск по городу, ни «мои
 * клубы», ни раздел «Мои записи» по нескольким клубам, ни правило «клуб
 * находится по городу ЗАЛА, а не только по городу клуба» — а именно оно
 * ломается тише всего.
 *
 * Зал в Минусинске при этом живёт в том же поясе, что головной: Хакасия и
 * Красноярский край в одном. Разные пояса между залами проверяются отдельно,
 * когда у клуба появится филиал за Уралом.
 */
async function seedNeighbour(cities: Map<string, string>): Promise<void> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'sayany' },
    update: {},
    create: {
      name: 'КНТ «Саяны»',
      slug: 'sayany',
      cityId: cities.get('Абакан')!,
      accentColor: '#b5541f',
      noShowChargePercent: 100,
    },
  });

  for (const tier of [
    { minMinutesBeforeStart: 60, chargePercent: 0 },
    { minMinutesBeforeStart: 0, chargePercent: 50 },
  ]) {
    await prisma.cancellationTier.upsert({
      where: {
        tenantId_minMinutesBeforeStart: {
          tenantId: tenant.id,
          minMinutesBeforeStart: tier.minMinutesBeforeStart,
        },
      },
      update: {},
      create: { tenantId: tenant.id, ...tier },
    });
  }

  const halls = [
    { name: 'Зал на Щетинкина', city: 'Абакан', address: 'Абакан, ул. Щетинкина, 12', fias: 'seed-abakan-shchetinkina-12' },
    // Второй зал в другом городе: по нему клуб обязан находиться в поиске
    // Минусинска, хотя сам клуб числится в Абакане.
    { name: 'Филиал в Минусинске', city: 'Минусинск', address: 'Минусинск, ул. Гоголя, 7', fias: 'seed-minusinsk-gogolya-7' },
  ];

  for (const item of halls) {
    const hall = await prisma.hall.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: item.name } },
      update: {},
      create: {
        tenantId: tenant.id,
        name: item.name,
        timezone: 'Asia/Krasnoyarsk',
        cityId: cities.get(item.city)!,
        address: item.address,
        addressFiasId: item.fias,
        hasRobotOption: false,
        tableHourPrice: 350 * RUB,
        tableExtra30MinPrice: 175 * RUB,
      },
    });

    for (let index = 1; index <= 4; index += 1) {
      const label = `Стол ${index}`;

      await prisma.table.upsert({
        where: { hallId_label: { hallId: hall.id, label } },
        update: {},
        create: { tenantId: tenant.id, hallId: hall.id, label },
      });
    }
  }

  const existing = await prisma.tournamentType.findFirst({
    where: { tenantId: tenant.id, name: 'Открытый турнир' },
    select: { id: true },
  });

  if (!existing) {
    await prisma.tournamentType.create({
      data: { tenantId: tenant.id, name: 'Открытый турнир', price: 500 * RUB },
    });
  }

  console.log(`Клуб «${tenant.name}» (slug: ${tenant.slug}) готов.`);
}

main()
  .catch((error: unknown) => {
    console.error('Сид не выполнен:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
