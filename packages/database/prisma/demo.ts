/**
 * Демонстрационные данные «Енисея»: ближайшие занятия и турниры.
 *
 * Отдельно от `seed.ts` намеренно. Сид — это НАСТРОЙКА клуба: города, залы,
 * столы, справочники, ступени отмены. Она не устаревает. А здесь выдуманное
 * расписание на ближайшие дни, и в сиде оно превратило бы воспроизводимую
 * настройку в набор дат, который через месяц весь в прошлом.
 *
 * Заводит: неделю занятий разных типов с разной вместимостью и несколько
 * ближайших турниров. Даты считаются от «сегодня», а не записаны константами —
 * иначе демо протухает через неделю после написания.
 *
 * Идемпотентен: повторный запуск не дублирует — занятие и турнир опознаются по
 * паре «тип + момент начала».
 *
 * Запуск: pnpm db:seed-demo (после pnpm db:seed — он опирается на его
 * справочники и на тренера клуба).
 */
import { PrismaClient, Role } from '../generated/client/index.js';

const prisma = new PrismaClient();

const HOUR = 60 * 60 * 1000;

/**
 * Расписание недели «Енисея» в местном времени зала.
 *
 * `day` — смещение в днях от сегодня, `hour` — час начала по времени зала.
 * Пояс берётся у зала, а не у клуба: он свойство зала с тех пор, как залы
 * одной организации могут стоять в разных регионах.
 */
const TRAININGS: { day: number; hour: number; type: string; capacity: number }[] = [
  { day: 1, hour: 18, type: 'Общая групповая тренировка', capacity: 12 },
  { day: 1, hour: 16, type: 'Детская тренировка', capacity: 8 },
  { day: 2, hour: 19, type: 'Первая подача (для начинающих)', capacity: 6 },
  { day: 3, hour: 18, type: 'Общая групповая тренировка', capacity: 12 },
  { day: 4, hour: 16, type: 'Детская тренировка', capacity: 8 },
  { day: 5, hour: 19, type: 'Общая групповая тренировка', capacity: 12 },
];

/** Турниры по выходным — как их и проводит клуб. */
const TOURNAMENTS: { day: number; hour: number; type: string }[] = [
  { day: 2, hour: 19, type: 'Пятничное турне' },
  { day: 5, hour: 11, type: 'Клуб 100' },
  { day: 6, hour: 11, type: 'Абсолют' },
  { day: 12, hour: 11, type: 'Клуб 200' },
];

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: 'yenisey' },
    select: { id: true },
  });

  if (!tenant) {
    throw new Error('Клуб «Енисей» не найден. Сначала выполните pnpm db:seed.');
  }

  const hall = await prisma.hall.findFirst({
    where: { tenantId: tenant.id },
    select: { timezone: true },
  });

  if (!hall) {
    throw new Error('У клуба нет зала. Сначала выполните pnpm db:seed.');
  }

  // Занятие без тренера не заведётся: оно не попало бы в его статистику, и
  // через месяц выяснить, кто его вёл, было бы неоткуда. Настоящего тренера
  // берём, если он есть, — иначе заводим демонстрационного: смысл этого
  // скрипта в том, что база разворачивается с нуля одной командой.
  const coachId = await ensureCoach(tenant.id);

  let sessions = 0;

  for (const item of TRAININGS) {
    const type = await prisma.trainingType.findFirst({
      where: { tenantId: tenant.id, name: item.type },
      select: { id: true },
    });

    if (!type) continue;

    const startsAt = instantAt(item.day, item.hour, hall.timezone);

    const existing = await prisma.trainingSession.findFirst({
      where: { tenantId: tenant.id, trainingTypeId: type.id, startsAt },
      select: { id: true },
    });

    if (existing) continue;

    await prisma.trainingSession.create({
      data: {
        tenantId: tenant.id,
        trainingTypeId: type.id,
        coachId,
        startsAt,
        // Полтора часа — обычная длительность группового занятия «Енисея».
        endsAt: new Date(startsAt.getTime() + 1.5 * HOUR),
        capacity: item.capacity,
      },
    });

    sessions += 1;
  }

  let tournaments = 0;

  for (const item of TOURNAMENTS) {
    const type = await prisma.tournamentType.findFirst({
      where: { tenantId: tenant.id, name: item.type },
      select: { id: true },
    });

    if (!type) continue;

    const startsAt = instantAt(item.day, item.hour, hall.timezone);

    const existing = await prisma.tournament.findFirst({
      where: { tenantId: tenant.id, tournamentTypeId: type.id, startsAt },
      select: { id: true },
    });

    if (existing) continue;

    await prisma.tournament.create({
      // Турниры «Енисея» идут около четырёх часов; точное окончание
      // администратор задаст, поставив турнир в сетку.
      data: {
        tenantId: tenant.id,
        tournamentTypeId: type.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * HOUR),
      },
    });

    tournaments += 1;
  }

  console.log(`Демо-данные: занятий ${sessions}, турниров ${tournaments}.`);
  console.log('Занятия и турниры в расписание зала НЕ ставятся: сетку рисует администратор.');
}

/**
 * Тренер клуба: настоящий, а если такого нет — демонстрационный.
 *
 * Пароль у демо-тренера заведомо нерабочий: войти под ним нельзя, и это
 * намеренно. Ему не нужно входить — он нужен как имя, стоящее в расписании, а
 * учётка с известным паролем в демо-скрипте однажды уехала бы в прод.
 */
async function ensureCoach(tenantId: string): Promise<string> {
  const existing = await prisma.tenantMembership.findFirst({
    where: { tenantId, role: Role.COACH, coachProfile: { isNot: null } },
    select: { userId: true },
  });

  if (existing) {
    return existing.userId;
  }

  const user = await prisma.user.upsert({
    where: { email: 'demo-coach@yenisey.club' },
    update: {},
    create: {
      email: 'demo-coach@yenisey.club',
      phone: '+79130000000',
      birthDate: new Date('1985-05-05'),
      // Не хеш пароля, а строка, под которую пароль не подберётся: bcrypt
      // такого формата не примет вовсе, и вход невозможен.
      passwordHash: 'demo-account-cannot-sign-in',
      fullName: 'Тренеров Сергей Петрович',
    },
    select: { id: true },
  });

  await prisma.tenantMembership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId } },
    update: { role: Role.COACH },
    create: { userId: user.id, tenantId, role: Role.COACH },
  });

  await prisma.coachProfile.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId } },
    update: {},
    create: { userId: user.id, tenantId },
  });

  console.log('Заведён демонстрационный тренер: Тренеров С. (войти под ним нельзя).');

  return user.id;
}

/**
 * Момент начала: «через N дней, в H часов ПО ВРЕМЕНИ ЗАЛА» → UTC.
 *
 * Считается перебором смещения, а не арифметикой над UTC: у зала своя зона, и
 * «18:00 в Красноярске» — это разное мгновение UTC зимой и летом. Приём тот же,
 * что в смоуке (`instantAt`): берём предполагаемый момент, смотрим, какой
 * местный час он даёт, и правим на разницу.
 */
function instantAt(daysAhead: number, hour: number, timezone: string): Date {
  const day = new Date();
  day.setDate(day.getDate() + daysAhead);

  const guess = new Date(
    Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0, 0),
  );

  const local = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  }).format(guess);

  // Разница между тем, что показали часы в зале, и тем, что мы хотели.
  // Приводим к диапазону −12..+12: иначе пояс за линией перемены дат уехал бы
  // на сутки.
  let shift = Number(local) - hour;

  if (shift > 12) shift -= 24;
  if (shift < -12) shift += 24;

  return new Date(guess.getTime() - shift * HOUR);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
