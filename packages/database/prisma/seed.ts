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
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'yenisey' },
    update: {},
    create: {
      name: 'АНТ «Енисей»',
      slug: 'yenisey',
      timezone: 'Asia/Krasnoyarsk',
      noShowChargePercent: 100,
    },
  });

  // Цены и шаг брони живут у зала, а не у клуба: залы различаются
  // оборудованием и ценой, и «Енисей» рано или поздно откроет второй.
  const hall = await prisma.hall.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'Основной зал' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Основной зал',
      hasRobotOption: true,
      tableHourPrice: 400 * RUB,
      tableExtra30MinPrice: 200 * RUB,
      robot30MinPrice: 600 * RUB,
      robot60MinPrice: 900 * RUB,
      robotExtra30MinPrice: 300 * RUB,
    },
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

  const admin = await prisma.user.findFirst({
    where: { tenantId: tenant.id, role: Role.ADMIN },
    select: { email: true },
  });

  console.log(`Клуб «${tenant.name}» (slug: ${tenant.slug}) готов.`);
  console.log(
    admin
      ? `Администратор уже заведён: ${admin.email}`
      : 'Администратор не заведён: создайте его отдельной командой — пароль не должен попадать в репозиторий.',
  );
}

main()
  .catch((error: unknown) => {
    console.error('Сид не выполнен:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
