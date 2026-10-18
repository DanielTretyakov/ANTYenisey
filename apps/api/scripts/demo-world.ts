/**
 * «Живой мир» для демо-стенда: четыре клуба в трёх регионах, у каждого свои
 * залы, тренеры, виды занятий, расписание недели, мероприятия, клиенты с
 * записями и посещениями, абонементы, ленты и новости платформы.
 *
 * Только для демо-стенда (demo.ant-yenisey.ru) и локальной базы — НЕ для
 * боевой базы: здесь выдуманные люди и демо-учётки с известным паролем.
 *
 *   DATABASE_URL=…/yenisey_demo DEMO_PASSWORD='...' pnpm demo:world
 *
 * Окно — четыре недели назад и три вперёд от сегодня. Прошлое отмечено
 * («пришёл» / «не пришёл», визиты в журнале) — отсюда рейтинг посещений и
 * статистика тренеров. Повторный запуск идемпотентен и «живой»: уже
 * разложенные дни зала не трогает, добавляет новые на краю окна и отмечает
 * записи, которые за это время стали прошлыми. Поэтому его гоняют раз в
 * сутки, и демо не устаревает.
 *
 * Пишет напрямую через Prisma, держа правила схемы: деньги в копейках, цена
 * записи — снимок цены вида, `chargeRatio` у отмеченных, визит — одна строка
 * на запись, журнал абонементов — только вставки. Сообщений не ставит.
 *
 * Перед запуском в базе нужен справочник городов: `pnpm db:seed-cities`.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient, Role, type Prisma } from '@yenisey/database';
import { hashPassword } from '../src/auth/password.ts';
import { quote } from '../src/booking/pricing.ts';

const prisma = new PrismaClient();

const RUB = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const PAST_DAYS = 28;
const FUTURE_DAYS = 21;
/** Учётки массовки: войти под ними нельзя — это не хеш argon2. */
const NO_LOGIN = 'demo-account-cannot-sign-in';
const DOMAIN = 'knt.test';
/**
 * Демо-учётки, под которыми входят на показе. В прошлом они ходят наравне со
 * всеми (визиты, рейтинг), а вперёд записаны изредка: иначе «Мои записи»
 * игрока из Красноярска были бы забиты занятиями во всех клубах сразу.
 */
const DEMO_IDS = new Set<string>();

/** Участники мероприятия: `pick`, из которого демо-учётки в будущем редко проходят. */
function attendees(random: () => number, pool: readonly Person[], count: number, startsAt: Date, now: Date): Person[] {
  return pick(random, pool, count).filter((person) => startsAt <= now || !DEMO_IDS.has(person.id) || random() < 0.12);
}

// ---------------------------------------------------------------------------
// Данные мира

type Hours = { weekdays: [string, string] | null; saturday: [string, string] | null; sunday: [string, string] | null };

interface HallDef {
  name: string;
  city: string;
  address: string;
  fias: string;
  timezone: string;
  tables: number;
  price: number;
  extra: number;
  robot?: { m30: number; m60: number; extra: number };
  hours: Hours;
  phone?: string;
}

/** Слот недели: дни ISO (1 — пн), время по часам зала, столы с 1-го по `tables`. */
interface TrainingSlot {
  hall: number;
  days: number[];
  start: string;
  end: string;
  tables: [number, number];
  type: number;
  coach: number;
  capacity: number;
}

interface TournamentSlot {
  hall: number;
  days: number[];
  start: string;
  end: string;
  tables: [number, number];
  type: number;
}

interface ClubDef {
  slug: string;
  name: string;
  city: string;
  accent: string;
  phone: string;
  email: string;
  vk: string;
  noShow: number;
  description: string;
  values: { title: string; text: string }[];
  halls: HallDef[];
  coaches: { name: string; gender: 'MALE' | 'FEMALE'; born: string; halls?: number[]; group: number; individual: number; achievements: string; inventory: string }[];
  trainingTypes: { name: string; price: number; description: string; halls?: number[] }[];
  tournamentTypes: { name: string; price: number; rating?: string; description: string }[];
  plans: { name: string; trainings: number[]; tournaments: number[]; rental?: boolean; variants: { visits: number | null; days: number | null; price: number }[] }[];
  trainings: TrainingSlot[];
  tournaments: TournamentSlot[];
  /** Аренды дня: стол с конца зала, начало и минуты. */
  rentals: { start: string; minutes: number; robot?: boolean }[];
  posts: { title: string; body: string; daysAgo: number }[];
}

const KRSK = 'Asia/Krasnoyarsk';
const WEEKDAYS: Hours = { weekdays: ['08:00', '23:00'], saturday: ['10:00', '21:00'], sunday: ['10:00', '21:00'] };

const CLUBS: ClubDef[] = [
  {
    slug: 'yenisey',
    name: 'АНТ «Енисей»',
    city: 'Красноярск',
    accent: '#126b54',
    phone: '+73912000000',
    email: 'info@ant-yenisey.ru',
    vk: 'https://vk.com/ant_yenisey',
    noShow: 100,
    description:
      'Академия настольного тенниса «Енисей» — три зала в Красноярске. Детская школа с семи лет, взрослые группы всех уровней, турниры по выходным и роботы для отработки техники.',
    values: [
      { title: 'Тренеры с разрядами', text: 'Все тренеры — действующие спортсмены с опытом соревнований.' },
      { title: 'Столы турнирного уровня', text: 'Столы и мячи, на которых играют краевые соревнования.' },
      { title: 'Турниры каждую неделю', text: 'Пятничное турне и турниры выходного дня — для любого рейтинга.' },
    ],
    halls: [
      { name: 'Основной зал', city: 'Красноярск', address: 'Красноярск, ул. Партизана Железняка, 25', fias: 'seed-krasnoyarsk-partizana-zheleznyaka-25', timezone: KRSK, tables: 8, price: 400, extra: 200, robot: { m30: 600, m60: 900, extra: 300 }, hours: WEEKDAYS },
      { name: 'Пироги', city: 'Красноярск', address: 'Красноярск, ул. Пирогова, 13', fias: 'seed-krasnoyarsk-pirogova-13', timezone: KRSK, tables: 5, price: 400, extra: 200, robot: { m30: 600, m60: 900, extra: 300 }, hours: { weekdays: ['10:00', '22:00'], saturday: ['10:00', '20:00'], sunday: null } },
      { name: 'Баки', city: 'Красноярск', address: 'Красноярск, ул. Бакинских Комиссаров, 27', fias: 'seed-krasnoyarsk-bakinskikh-komissarov-27', timezone: KRSK, tables: 4, price: 350, extra: 175, hours: { weekdays: ['12:00', '22:00'], saturday: ['10:00', '18:00'], sunday: null }, phone: '+73912000011' },
    ],
    coaches: [
      { name: 'Ковалёв Андрей Сергеевич', gender: 'MALE', born: '1984-03-12', halls: [0, 1], group: 700, individual: 1800, achievements: 'Мастер спорта России.\nЧемпион Красноярского края 2015 и 2018 годов.\nТренер сборной края среди юниоров.', inventory: 'Основание Butterfly Viscaria, накладки Tenergy 05.' },
      { name: 'Соколова Марина Викторовна', gender: 'FEMALE', born: '1990-07-21', halls: [0], group: 550, individual: 1500, achievements: 'Кандидат в мастера спорта.\nПризёр первенства Сибири.\nВедёт детскую школу «Енисея» с 2016 года.', inventory: 'Основание Stiga Allround, накладки Mark V.' },
      { name: 'Белов Дмитрий Олегович', gender: 'MALE', born: '1992-11-02', halls: [0, 2], group: 600, individual: 1600, achievements: 'Кандидат в мастера спорта.\nПобедитель Кубка Красноярска 2021.', inventory: 'Основание Donic Waldner, накладки Bluefire M1.' },
      { name: 'Захарова Елена Игоревна', gender: 'FEMALE', born: '1987-05-30', group: 650, individual: 1700, achievements: 'Мастер спорта России.\nУчастница чемпионата России в парном разряде.', inventory: 'Основание Butterfly Timo Boll ALC, накладки Dignics 09C.' },
    ],
    trainingTypes: [
      { name: 'Общая групповая тренировка', price: 700, description: 'Для тех, кто уже держит ракетку: разминка, отработка ударов в парах, игровая практика. Уровень — от начального до продвинутого.' },
      { name: 'Первая подача (для начинающих)', price: 600, description: 'С нуля: хватка, стойка, базовые удары и подача. Ракетку дадим, приходите в спортивной обуви.' },
      { name: 'Детская тренировка', price: 500, description: 'Для детей 7–13 лет: координация, техника, игры. Группы по возрасту и уровню.' },
      { name: 'Тренировка с роботом', price: 800, description: 'Отработка ударов с роботом под присмотром тренера. Группа до четырёх человек.', halls: [0] },
    ],
    tournamentTypes: [
      { name: 'Пятничное турне', price: 700, description: 'Вечерний турнир для всех: группы, затем плей-офф. Итоги — в ленте клуба.' },
      { name: 'Клуб 100', price: 700, rating: '100', description: 'Турнир для игроков с рейтингом до 100.' },
      { name: 'Абсолют', price: 900, description: 'Открытый турнир без ограничений по рейтингу.' },
    ],
    plans: [
      { name: 'Абонемент на детские тренировки', trainings: [2], tournaments: [], variants: [{ visits: 8, days: null, price: 4000 }, { visits: 16, days: null, price: 6800 }] },
      { name: 'Повышаем обороты', trainings: [0, 1], tournaments: [0, 1, 2], variants: [{ visits: 10, days: 30, price: 5950 }, { visits: null, days: 30, price: 10000 }] },
      { name: 'Аренда стола', trainings: [], tournaments: [], rental: true, variants: [{ visits: 10, days: 60, price: 3600 }] },
    ],
    trainings: [
      { hall: 0, days: [1, 3, 5], start: '18:00', end: '19:30', tables: [1, 4], type: 0, coach: 0, capacity: 12 },
      { hall: 0, days: [2, 4], start: '16:00', end: '17:30', tables: [1, 3], type: 2, coach: 1, capacity: 8 },
      { hall: 0, days: [2, 4], start: '19:00', end: '20:30', tables: [4, 6], type: 1, coach: 2, capacity: 6 },
      { hall: 0, days: [6], start: '10:00', end: '11:30', tables: [1, 3], type: 2, coach: 1, capacity: 8 },
      { hall: 0, days: [7], start: '12:00', end: '13:30', tables: [1, 2], type: 3, coach: 3, capacity: 4 },
      { hall: 1, days: [1, 3], start: '17:00', end: '18:30', tables: [1, 3], type: 2, coach: 3, capacity: 8 },
      { hall: 1, days: [2, 4], start: '19:00', end: '20:30', tables: [1, 4], type: 0, coach: 0, capacity: 10 },
      { hall: 2, days: [1, 3, 5], start: '19:00', end: '20:30', tables: [1, 3], type: 1, coach: 2, capacity: 6 },
      { hall: 2, days: [6], start: '11:00', end: '12:30', tables: [1, 3], type: 0, coach: 3, capacity: 8 },
    ],
    tournaments: [
      { hall: 0, days: [5], start: '19:30', end: '23:00', tables: [1, 6], type: 0 },
      { hall: 0, days: [6], start: '12:00', end: '16:00', tables: [1, 6], type: 1 },
      { hall: 0, days: [7], start: '15:00', end: '19:00', tables: [1, 6], type: 2 },
    ],
    rentals: [{ start: '12:00', minutes: 90 }, { start: '19:30', minutes: 90, robot: true }],
    posts: [
      { title: 'Осенний сезон открыт', body: 'С 1 октября — новое расписание групп. **Детские тренировки** теперь и по субботам в 10:00.\n\nЗаписывайтесь заранее: в группах ограничено число мест.', daysAgo: 16 },
      { title: 'Пятничное турне: итоги недели', body: 'Сыграли 18 человек, лучший — Павел Накатов. Следующее турне — в эту пятницу в 19:30.\n\n- группы по 4 человека\n- плей-офф до двух побед', daysAgo: 3 },
    ],
  },
  {
    slug: 'stolby',
    name: 'КНТ «Столбы»',
    city: 'Красноярск',
    accent: '#1f4f9c',
    phone: '+73912100000',
    email: 'hello@knt-stolby.ru',
    vk: 'https://vk.com/knt_stolby',
    noShow: 50,
    description:
      'Клуб настольного тенниса «Столбы»: два зала — на Свободном и в Академгородке. Дружелюбная атмосфера, женская группа и детская секция, турнир выходного дня каждое воскресенье.',
    values: [
      { title: 'Для всей семьи', text: 'Детская секция и взрослые группы в одно время — приходите вместе.' },
      { title: 'Женская группа', text: 'Отдельная группа с тренером-женщиной по вторникам и четвергам.' },
      { title: 'Рядом с домом', text: 'Два зала в разных районах — выбирайте удобный.' },
    ],
    halls: [
      { name: 'Зал на Свободном', city: 'Красноярск', address: 'Красноярск, пр-кт Свободный, 64', fias: 'seed-krasnoyarsk-svobodnyy-64', timezone: KRSK, tables: 6, price: 350, extra: 175, robot: { m30: 550, m60: 850, extra: 275 }, hours: WEEKDAYS },
      { name: 'Зал в Академгородке', city: 'Красноярск', address: 'Красноярск, Академгородок, 17', fias: 'seed-krasnoyarsk-akademgorodok-17', timezone: KRSK, tables: 4, price: 300, extra: 150, hours: { weekdays: ['14:00', '22:00'], saturday: ['10:00', '18:00'], sunday: null } },
    ],
    coaches: [
      { name: 'Медведев Павел Андреевич', gender: 'MALE', born: '1982-09-14', group: 650, individual: 1600, achievements: 'Мастер спорта России.\nТренер высшей категории.', inventory: 'Основание Butterfly Innerforce, накладки Rozena.' },
      { name: 'Орлова Анастасия Сергеевна', gender: 'FEMALE', born: '1994-02-08', halls: [0], group: 600, individual: 1400, achievements: 'Кандидат в мастера спорта.\nЧемпионка Красноярска среди женщин 2022.', inventory: 'Основание Stiga Carbo, накладки DNA.' },
      { name: 'Лебедев Константин Юрьевич', gender: 'MALE', born: '1989-12-19', group: 500, individual: 1300, achievements: 'Первый спортивный разряд.\nВедёт детскую секцию «Столбов».', inventory: 'Основание Donic Ovtcharov, накладки Acuda.' },
    ],
    trainingTypes: [
      { name: 'Групповая тренировка', price: 650, description: 'Взрослая группа: техника, тактика, игровая практика.' },
      { name: 'Женская группа', price: 600, description: 'Группа для девушек и женщин любого уровня.', halls: [0] },
      { name: 'Детская секция', price: 450, description: 'Для детей 7–13 лет: игры, техника и первые соревнования.' },
    ],
    tournamentTypes: [
      { name: 'Турнир выходного дня', price: 600, description: 'Воскресный турнир для всех: группы и плей-офф.' },
      { name: 'Кубок Столбов', price: 900, description: 'Главный турнир клуба, раз в месяц.' },
    ],
    plans: [
      { name: 'Взрослый абонемент', trainings: [0, 1], tournaments: [0], variants: [{ visits: 8, days: 30, price: 4500 }, { visits: 12, days: 45, price: 6300 }] },
      { name: 'Детская секция', trainings: [2], tournaments: [], variants: [{ visits: 8, days: 30, price: 3200 }] },
    ],
    trainings: [
      { hall: 0, days: [1, 3, 5], start: '18:30', end: '20:00', tables: [1, 4], type: 0, coach: 0, capacity: 12 },
      { hall: 0, days: [2, 4], start: '18:00', end: '19:30', tables: [1, 3], type: 1, coach: 1, capacity: 8 },
      { hall: 0, days: [6], start: '10:00', end: '11:30', tables: [1, 3], type: 2, coach: 2, capacity: 10 },
      { hall: 1, days: [2, 4], start: '17:00', end: '18:30', tables: [1, 3], type: 2, coach: 2, capacity: 8 },
      { hall: 1, days: [6], start: '13:00', end: '14:30', tables: [1, 3], type: 0, coach: 0, capacity: 8 },
    ],
    tournaments: [{ hall: 0, days: [7], start: '11:00', end: '15:00', tables: [1, 5], type: 0 }],
    rentals: [{ start: '15:00', minutes: 60 }, { start: '20:00', minutes: 90 }],
    posts: [
      { title: 'Женская группа набирает участниц', body: 'По вторникам и четвергам в 18:00 — женская группа с Анастасией Орловой. Первое занятие — бесплатно.', daysAgo: 9 },
      { title: 'Воскресный турнир: 22 участника', body: 'Спасибо всем, кто пришёл! Фото и сетка — в нашей группе ВКонтакте.', daysAgo: 2 },
    ],
  },
  {
    slug: 'sayany',
    name: 'КНТ «Саяны»',
    city: 'Абакан',
    accent: '#b5541f',
    phone: '+73902200300',
    email: 'hello@knt-sayany.ru',
    vk: 'https://vk.com/knt_sayany',
    noShow: 50,
    description:
      'Клуб настольного тенниса Хакасии: зал в центре Абакана и филиал в Минусинске. Растим спортсменов с детства и даём взрослым место, где можно сыграть после работы.',
    values: [
      { title: 'Спорт для всей семьи', text: 'Детские группы и взрослые тренировки в одно время.' },
      { title: 'Честные цены', text: 'Стол — от 350 ₽ в час, первая тренировка новичка бесплатно.' },
      { title: 'Два города — один клуб', text: 'Абонемент действует и в Абакане, и в Минусинске.' },
    ],
    halls: [
      { name: 'Зал на Щетинкина', city: 'Абакан', address: 'Абакан, ул. Щетинкина, 12', fias: 'seed-abakan-shchetinkina-12', timezone: KRSK, tables: 4, price: 350, extra: 175, hours: { weekdays: ['08:00', '22:00'], saturday: ['10:00', '20:00'], sunday: ['10:00', '20:00'] }, phone: '+73902200301' },
      { name: 'Филиал в Минусинске', city: 'Минусинск', address: 'Минусинск, ул. Гоголя, 7', fias: 'seed-minusinsk-gogolya-7', timezone: KRSK, tables: 4, price: 300, extra: 150, hours: { weekdays: ['15:00', '21:00'], saturday: ['11:00', '17:00'], sunday: null } },
    ],
    coaches: [
      { name: 'Кызласов Артём Николаевич', gender: 'MALE', born: '1986-04-03', halls: [0], group: 550, individual: 1300, achievements: 'Мастер спорта России.\nЧемпион Республики Хакасия.', inventory: 'Основание Yasaka Ma Lin, накладки Rakza 7.' },
      { name: 'Чебодаева Дарья Ивановна', gender: 'FEMALE', born: '1995-08-27', halls: [0], group: 450, individual: 1100, achievements: 'Кандидат в мастера спорта.\nТренер детской группы.', inventory: 'Основание Stiga Allround Classic.' },
      { name: 'Ермаков Виктор Степанович', gender: 'MALE', born: '1979-01-15', halls: [1], group: 500, individual: 1200, achievements: 'Первый спортивный разряд.\nОснователь минусинского филиала.', inventory: 'Основание Butterfly Primorac.' },
    ],
    trainingTypes: [
      { name: 'Общая тренировка', price: 550, description: 'Взрослая группа любого уровня.' },
      { name: 'Детская группа', price: 400, description: 'Для детей 7–13 лет.' },
    ],
    tournamentTypes: [
      { name: 'Открытый турнир', price: 500, description: 'Субботний турнир для всех желающих.' },
      { name: 'Первенство клуба', price: 600, description: 'Ежемесячное первенство с рейтингом клуба.' },
    ],
    plans: [{ name: 'Абонемент «Саяны»', trainings: [0, 1], tournaments: [0], variants: [{ visits: 8, days: 30, price: 3800 }] }],
    trainings: [
      { hall: 0, days: [1, 3, 5], start: '18:00', end: '19:30', tables: [1, 3], type: 0, coach: 0, capacity: 10 },
      { hall: 0, days: [2, 4], start: '16:00', end: '17:30', tables: [1, 3], type: 1, coach: 1, capacity: 8 },
      { hall: 1, days: [2, 4], start: '18:00', end: '19:30', tables: [1, 3], type: 0, coach: 2, capacity: 8 },
      { hall: 1, days: [6], start: '11:00', end: '12:30', tables: [1, 2], type: 1, coach: 2, capacity: 6 },
    ],
    tournaments: [{ hall: 0, days: [6], start: '12:00', end: '16:00', tables: [1, 3], type: 0 }],
    rentals: [{ start: '13:00', minutes: 60 }, { start: '20:00', minutes: 60 }],
    posts: [{ title: 'Новые столы в Минусинске', body: 'В филиале поставили два новых турнирных стола. Ждём на тренировках!', daysAgo: 6 }],
  },
  {
    slug: 'baikal',
    name: 'КНТ «Байкал»',
    city: 'Иркутск',
    accent: '#5b3fa8',
    phone: '+73952400500',
    email: 'info@knt-baikal.ru',
    vk: 'https://vk.com/knt_baikal',
    noShow: 100,
    description:
      'Клуб настольного тенниса «Байкал» в Иркутске: два зала, детская школа, тактические группы и собственная лига. Время на сайте — иркутское.',
    values: [
      { title: 'Своя лига', text: 'Байкальская лига каждую субботу — растите в рейтинге клуба.' },
      { title: 'Тактика и подача', text: 'Отдельные занятия по подаче и тактике для тех, кто уже играет.' },
      { title: 'Детская школа', text: 'Группы по возрасту с шести лет.' },
    ],
    halls: [
      { name: 'Зал на Карла Маркса', city: 'Иркутск', address: 'Иркутск, ул. Карла Маркса, 40', fias: 'seed-irkutsk-karla-marksa-40', timezone: 'Asia/Irkutsk', tables: 6, price: 450, extra: 225, robot: { m30: 650, m60: 950, extra: 325 }, hours: WEEKDAYS },
      { name: 'Зал на Лермонтова', city: 'Иркутск', address: 'Иркутск, ул. Лермонтова, 81', fias: 'seed-irkutsk-lermontova-81', timezone: 'Asia/Irkutsk', tables: 4, price: 400, extra: 200, hours: { weekdays: ['14:00', '22:00'], saturday: ['10:00', '20:00'], sunday: ['10:00', '18:00'] } },
    ],
    coaches: [
      { name: 'Иванов Сергей Геннадьевич', gender: 'MALE', born: '1980-06-11', halls: [0], group: 700, individual: 1800, achievements: 'Мастер спорта России.\nЧемпион Иркутской области.', inventory: 'Основание Butterfly Zhang Jike ALC.' },
      { name: 'Петрова Ольга Николаевна', gender: 'FEMALE', born: '1991-10-05', halls: [0], group: 550, individual: 1500, achievements: 'Кандидат в мастера спорта.\nВедёт детскую школу.', inventory: 'Основание Stiga Clipper.' },
      { name: 'Шестаков Роман Алексеевич', gender: 'MALE', born: '1993-03-29', halls: [0], group: 700, individual: 1700, achievements: 'Кандидат в мастера спорта.\nСпециалист по подаче и тактике.', inventory: 'Основание Donic Persson.' },
      { name: 'Дамбаева Туяна Баировна', gender: 'FEMALE', born: '1988-12-02', halls: [1], group: 600, individual: 1500, achievements: 'Мастер спорта России.\nУчастница первенства Сибири.', inventory: 'Основание Butterfly Viscaria.' },
    ],
    trainingTypes: [
      { name: 'Групповая тренировка', price: 700, description: 'Взрослая группа: техника и игровая практика.' },
      { name: 'Детская школа', price: 500, description: 'Дети 6–13 лет, группы по возрасту.' },
      { name: 'Тактика и подача', price: 750, description: 'Для играющих: подача, приём, тактические схемы.', halls: [0] },
    ],
    tournamentTypes: [
      { name: 'Байкальская лига', price: 800, description: 'Еженедельная лига клуба с рейтингом.' },
      { name: 'Турнир новичков', price: 500, rating: '50', description: 'Для тех, кто играет меньше года.' },
    ],
    plans: [
      { name: 'Абонемент «Байкал»', trainings: [0, 2], tournaments: [0, 1], variants: [{ visits: 8, days: 30, price: 5200 }, { visits: null, days: 30, price: 9000 }] },
      { name: 'Детская школа', trainings: [1], tournaments: [], variants: [{ visits: 8, days: 30, price: 3600 }] },
    ],
    trainings: [
      { hall: 0, days: [1, 3, 5], start: '18:00', end: '19:30', tables: [1, 4], type: 0, coach: 0, capacity: 12 },
      { hall: 0, days: [2, 4], start: '17:00', end: '18:30', tables: [1, 3], type: 1, coach: 1, capacity: 10 },
      { hall: 0, days: [2, 4], start: '19:00', end: '20:30', tables: [4, 5], type: 2, coach: 2, capacity: 6 },
      { hall: 1, days: [1, 3], start: '17:30', end: '19:00', tables: [1, 3], type: 1, coach: 3, capacity: 8 },
      { hall: 1, days: [6], start: '10:00', end: '11:30', tables: [1, 3], type: 0, coach: 3, capacity: 8 },
    ],
    tournaments: [
      { hall: 0, days: [6], start: '12:00', end: '16:00', tables: [1, 5], type: 0 },
      { hall: 1, days: [7], start: '11:00', end: '14:00', tables: [1, 3], type: 1 },
    ],
    rentals: [{ start: '14:00', minutes: 60 }, { start: '20:30', minutes: 90 }],
    posts: [
      { title: 'КНТ «Байкал» теперь на платформе', body: 'Записывайтесь на тренировки и бронируйте столы онлайн. Время на сайте — иркутское.', daysAgo: 12 },
      { title: 'Байкальская лига: таблица после 5 туров', body: 'Лидирует Роман Шестаков, на втором месте — Анна Сергеева. Следующий тур — в субботу в 12:00.', daysAgo: 1 },
    ],
  },
];

const MALE = ['Александр', 'Дмитрий', 'Максим', 'Сергей', 'Андрей', 'Алексей', 'Артём', 'Илья', 'Кирилл', 'Михаил', 'Никита', 'Павел', 'Роман', 'Егор', 'Иван', 'Олег'];
const FEMALE = ['Анна', 'Мария', 'Елена', 'Ольга', 'Наталья', 'Екатерина', 'Анастасия', 'Татьяна', 'Юлия', 'Ирина', 'Дарья', 'Светлана', 'Ксения', 'Алина'];
const SURNAMES = ['Смирнов', 'Кузнецов', 'Попов', 'Васильев', 'Петров', 'Новиков', 'Фёдоров', 'Морозов', 'Волков', 'Алексеев', 'Лебедев', 'Семёнов', 'Егоров', 'Павлов', 'Козлов', 'Степанов', 'Николаев', 'Орлов', 'Андреев', 'Макаров', 'Никитин', 'Захаров', 'Зайцев', 'Соловьёв', 'Борисов', 'Яковлев', 'Григорьев', 'Романов', 'Воробьёв', 'Сергеев', 'Накатов', 'Тимофеев'];
const PATRONYMIC_M = ['Александрович', 'Сергеевич', 'Андреевич', 'Дмитриевич', 'Игоревич', 'Олегович', 'Павлович', 'Викторович'];
const PATRONYMIC_F = ['Александровна', 'Сергеевна', 'Андреевна', 'Дмитриевна', 'Игоревна', 'Олеговна', 'Павловна', 'Викторовна'];

// ---------------------------------------------------------------------------
// Случайность — воспроизводимая: от строки-ключа, чтобы повторный запуск
// принимал те же решения о тех же записях.

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function rng(key: string): () => number {
  let state = hash(key) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, list: readonly T[], count: number): T[] {
  const copy = [...list];
  const out: T[] = [];
  while (out.length < count && copy.length > 0) {
    out.push(copy.splice(Math.floor(random() * copy.length), 1)[0]!);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Время по часам зала

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h! * 60 + m!;
}

function localDate(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function isoWeekday(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Момент «дата + минута дня по часам зала». Смещение пояса — через Intl. */
function instantAt(date: string, minute: number, timezone: string): Date {
  const guess = Date.parse(`${date}T00:00:00Z`) + minute * 60_000;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(guess));
  const get = (type: string): number => Number(parts.find((part) => part.type === type)!.value);
  const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));

  return new Date(guess - (shown - guess));
}

function workingHoursJson(hours: Hours): ({ open: string; close: string } | null)[] {
  const day = (value: [string, string] | null) => (value ? { open: value[0], close: value[1] } : null);
  return [1, 2, 3, 4, 5].map(() => day(hours.weekdays)).concat([day(hours.saturday), day(hours.sunday)]);
}

function hoursOn(hours: Hours, weekday: number): [number, number] | null {
  const value = weekday <= 5 ? hours.weekdays : weekday === 6 ? hours.saturday : hours.sunday;
  return value ? [minutesOf(value[0]), minutesOf(value[1])] : null;
}

// ---------------------------------------------------------------------------
// Люди

interface Person {
  id: string;
  name: string;
  child: boolean;
}

async function upsertUser(input: {
  email: string;
  fullName: string;
  gender: 'MALE' | 'FEMALE';
  birthDate: string;
  phone: string;
  passwordHash: string;
  platformOwner?: boolean;
}): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: { passwordHash: input.passwordHash },
    create: {
      email: input.email,
      fullName: input.fullName,
      gender: input.gender,
      birthDate: new Date(`${input.birthDate}T00:00:00Z`),
      phone: input.phone,
      passwordHash: input.passwordHash,
      personalDataConsentAt: new Date(),
      emailVerifiedAt: new Date(),
      platformRole: input.platformOwner ? 'OWNER' : null,
    },
    select: { id: true },
  });

  return user.id;
}

async function ensureMember(userId: string, tenantId: string, roles: Role[]): Promise<void> {
  const existing = await prisma.tenantMembership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    select: { roles: true },
  });

  if (!existing) {
    await prisma.tenantMembership.create({ data: { userId, tenantId, roles } });
  } else if (!roles.includes(Role.CLIENT) && existing.roles.includes(Role.CLIENT)) {
    // Клиент, ставший сотрудником, — роли сотрудника (CLIENT — только один).
    await prisma.tenantMembership.update({ where: { userId_tenantId: { userId, tenantId } }, data: { roles } });
  }

  // Анкета клиента заводится всем: сотрудник тоже записывается на мероприятия.
  await prisma.clientProfile.upsert({
    where: { userId_tenantId: { userId, tenantId } },
    update: {},
    create: { userId, tenantId },
  });
}

let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `+7999${String(phoneCounter).padStart(7, '0')}`;
}

/** Массовка: взрослые и дети с родителями. Имена и даты — от номера, не случайно. */
async function seedPeople(): Promise<{ adults: Person[]; kids: Person[]; guardians: Map<string, string> }> {
  const adults: Person[] = [];
  const kids: Person[] = [];
  const guardians = new Map<string, string>();

  for (let index = 0; index < 44; index += 1) {
    const random = rng(`adult-${index}`);
    const female = random() < 0.4;
    const first = (female ? FEMALE : MALE)[Math.floor(random() * (female ? FEMALE.length : MALE.length))]!;
    const surnameBase = SURNAMES[index % SURNAMES.length]!;
    const surname = female ? feminine(surnameBase) : surnameBase;
    const patronymic = (female ? PATRONYMIC_F : PATRONYMIC_M)[Math.floor(random() * 8)]!;
    const year = 1972 + Math.floor(random() * 33);
    const born = `${year}-${String(1 + Math.floor(random() * 12)).padStart(2, '0')}-${String(1 + Math.floor(random() * 27)).padStart(2, '0')}`;
    const name = `${surname} ${first} ${patronymic}`;
    const id = await upsertUser({ email: `player${index + 1}@${DOMAIN}`, fullName: name, gender: female ? 'FEMALE' : 'MALE', birthDate: born, phone: nextPhone(), passwordHash: NO_LOGIN });
    adults.push({ id, name, child: false });
  }

  // Дети — у первых двенадцати взрослых, с закреплением родителя.
  for (let index = 0; index < 12; index += 1) {
    const parent = adults[index]!;
    const random = rng(`kid-${index}`);
    const female = random() < 0.45;
    const surnameBase = parent.name.split(' ')[0]!.replace(/а$/, '');
    const surname = female ? feminine(surnameBase) : surnameBase;
    const first = (female ? FEMALE : MALE)[Math.floor(random() * 10)]!;
    const patronymic = (female ? PATRONYMIC_F : PATRONYMIC_M)[index % 8]!;
    const year = new Date().getFullYear() - 7 - Math.floor(random() * 6);
    const born = `${year}-${String(1 + Math.floor(random() * 12)).padStart(2, '0')}-${String(1 + Math.floor(random() * 27)).padStart(2, '0')}`;
    const name = `${surname} ${first} ${patronymic}`;
    const id = await upsertUser({ email: `kid${index + 1}@${DOMAIN}`, fullName: name, gender: female ? 'FEMALE' : 'MALE', birthDate: born, phone: nextPhone(), passwordHash: NO_LOGIN });
    kids.push({ id, name, child: true });
    guardians.set(id, parent.id);
  }

  return { adults, kids, guardians };
}

function feminine(surname: string): string {
  if (/(ов|ев|ёв|ин|ын)$/.test(surname)) return `${surname}а`;
  if (/ий$/.test(surname)) return surname.replace(/ий$/, 'ая');
  return surname;
}

async function ensureGuardianship(childId: string, guardianId: string): Promise<void> {
  const active = await prisma.guardianship.findFirst({ where: { childUserId: childId, status: 'ACTIVE' }, select: { id: true } });

  if (!active) {
    await prisma.guardianship.create({
      data: { childUserId: childId, guardianUserId: guardianId, status: 'ACTIVE', createdByUserId: guardianId, confirmedAt: new Date() },
    });
  }
}

// ---------------------------------------------------------------------------
// Клуб

interface ClubState {
  def: ClubDef;
  tenantId: string;
  halls: { id: string; def: HallDef; tables: string[] }[];
  coaches: string[];
  trainingTypes: { id: string; price: number }[];
  tournamentTypes: { id: string; price: number }[];
  ownerId: string;
  adminId: string;
  clients: Person[];
  kids: Person[];
}

async function cityId(name: string): Promise<string> {
  const city = await prisma.city.findFirst({ where: { name }, orderBy: { population: 'desc' }, select: { id: true } });

  if (!city) {
    throw new Error(`Города «${name}» нет в справочнике — сначала pnpm db:seed-cities.`);
  }

  return city.id;
}

async function seedClub(def: ClubDef, staff: { ownerId: string; adminId: string; managerId?: string; coachIds: string[] }): Promise<ClubState> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: def.slug },
    update: {},
    create: {
      slug: def.slug,
      name: def.name,
      publishedAt: new Date(Date.now() - 90 * DAY_MS),
      cityId: await cityId(def.city),
      accentColor: def.accent,
      phone: def.phone,
      email: def.email,
      vkUrl: def.vk,
      description: def.description,
      values: def.values,
      noShowChargePercent: def.noShow,
      attendanceTrackedSince: new Date(Date.now() - (PAST_DAYS + 30) * DAY_MS),
    },
    select: { id: true },
  });
  const tenantId = tenant.id;

  await prisma.tenantSubscription.createMany({ data: [{ tenantId, status: 'EXEMPT' }], skipDuplicates: true });

  for (const tier of [
    { minMinutesBeforeStart: 60, chargePercent: 0 },
    { minMinutesBeforeStart: 0, chargePercent: 50 },
  ]) {
    await prisma.cancellationTier.upsert({
      where: { tenantId_minMinutesBeforeStart: { tenantId, minMinutesBeforeStart: tier.minMinutesBeforeStart } },
      update: {},
      create: { tenantId, ...tier },
    });
  }

  // Персонал.
  await ensureMember(staff.ownerId, tenantId, [Role.OWNER]);
  await ensureMember(staff.adminId, tenantId, [Role.ADMIN]);
  if (staff.managerId) await ensureMember(staff.managerId, tenantId, [Role.MANAGER]);

  // Залы и столы.
  const halls: ClubState['halls'] = [];
  for (const item of def.halls) {
    const hall = await prisma.hall.upsert({
      where: { tenantId_name: { tenantId, name: item.name } },
      update: {},
      create: {
        tenantId,
        name: item.name,
        timezone: item.timezone,
        cityId: await cityId(item.city),
        address: item.address,
        addressFiasId: item.fias,
        phone: item.phone ?? null,
        tableHourPrice: item.price * RUB,
        tableExtra30MinPrice: item.extra * RUB,
        hasRobotOption: Boolean(item.robot),
        robot30MinPrice: item.robot ? item.robot.m30 * RUB : null,
        robot60MinPrice: item.robot ? item.robot.m60 * RUB : null,
        robotExtra30MinPrice: item.robot ? item.robot.extra * RUB : null,
        workingHours: workingHoursJson(item.hours),
      },
      select: { id: true },
    });

    const tables: string[] = [];
    for (let index = 1; index <= item.tables; index += 1) {
      const table = await prisma.table.upsert({
        where: { hallId_label: { hallId: hall.id, label: `Стол ${index}` } },
        update: {},
        create: { tenantId, hallId: hall.id, label: `Стол ${index}` },
        select: { id: true },
      });
      tables.push(table.id);
    }

    halls.push({ id: hall.id, def: item, tables });

    // Администратор отмечен на всех залах и стоит в шаблоне смен каждый день.
    await prisma.adminHall.createMany({ data: [{ userId: staff.adminId, hallId: hall.id, tenantId }], skipDuplicates: true });
    await prisma.staffShiftTemplate.createMany({
      data: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ tenantId, hallId: hall.id, weekday, userId: staff.adminId, assignedById: staff.ownerId })),
      skipDuplicates: true,
    });
  }

  // Управляющий — у всех залов, кроме первого (тот ведёт руководитель).
  if (staff.managerId) {
    for (const hall of halls.slice(1)) {
      await prisma.hall.update({ where: { id: hall.id }, data: { managerId: staff.managerId } });
    }
  }

  // Тренеры: карточка платформенная, цены — клубные.
  for (const [index, coach] of def.coaches.entries()) {
    const userId = staff.coachIds[index]!;
    await ensureMember(userId, tenantId, [Role.COACH]);
    await prisma.coachCard.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        achievements: coach.achievements,
        inventory: coach.inventory,
        socialLinks: [{ label: 'ВКонтакте', url: `https://vk.com/coach_${def.slug}_${index + 1}` }],
      },
    });
    await prisma.coachProfile.upsert({
      where: { userId_tenantId: { userId, tenantId } },
      update: {},
      create: { userId, tenantId, groupPrice: coach.group * RUB, individualPrice: coach.individual * RUB, priceNote: 'Первое занятие — бесплатно.' },
    });
    for (const hallIndex of coach.halls ?? []) {
      await prisma.coachHall.createMany({ data: [{ coachId: userId, hallId: halls[hallIndex]!.id, tenantId }], skipDuplicates: true });
    }
  }

  // Виды занятий и турниров.
  const trainingTypes: ClubState['trainingTypes'] = [];
  for (const type of def.trainingTypes) {
    let row = await prisma.trainingType.findFirst({ where: { tenantId, name: type.name }, select: { id: true } });
    row ??= await prisma.trainingType.create({ data: { tenantId, name: type.name, price: type.price * RUB, description: type.description }, select: { id: true } });
    for (const hallIndex of type.halls ?? []) {
      await prisma.trainingTypeHall.createMany({ data: [{ trainingTypeId: row.id, hallId: halls[hallIndex]!.id, tenantId }], skipDuplicates: true });
    }
    trainingTypes.push({ id: row.id, price: type.price * RUB });
  }

  const tournamentTypes: ClubState['tournamentTypes'] = [];
  for (const type of def.tournamentTypes) {
    let row = await prisma.tournamentType.findFirst({ where: { tenantId, name: type.name }, select: { id: true } });
    row ??= await prisma.tournamentType.create({
      data: { tenantId, name: type.name, price: type.price * RUB, ratingLabel: type.rating ?? null, description: type.description },
      select: { id: true },
    });
    tournamentTypes.push({ id: row.id, price: type.price * RUB });
  }

  // Типы спаррингов.
  for (const sparring of [
    { name: 'Взрослый', hourPrice: 1500, minAge: 14, maxAge: null, description: 'Спарринг с тренером для взрослых и подростков.' },
    { name: 'Детский', hourPrice: 1000, minAge: null, maxAge: 13, description: 'Спарринг с тренером для детей до 13 лет включительно.' },
  ]) {
    await prisma.sparringType.upsert({
      where: { tenantId_name: { tenantId, name: sparring.name } },
      update: {},
      create: { tenantId, ...sparring, hourPrice: sparring.hourPrice * RUB },
    });
  }

  // Тарифы абонементов.
  for (const plan of def.plans) {
    for (const variant of plan.variants) {
      const existing = await prisma.subscriptionPlan.findFirst({
        where: { tenantId, name: plan.name, visitsCount: variant.visits, durationDays: variant.days },
        select: { id: true },
      });
      if (existing) continue;

      const row = await prisma.subscriptionPlan.create({
        data: {
          tenantId,
          name: plan.name,
          visitsCount: variant.visits,
          durationDays: variant.days,
          price: variant.price * RUB,
          coversTableRental: plan.rental ?? false,
        },
        select: { id: true },
      });
      await prisma.subscriptionPlanTrainingType.createMany({
        data: plan.trainings.map((index) => ({ planId: row.id, trainingTypeId: trainingTypes[index]!.id, tenantId })),
      });
      await prisma.subscriptionPlanTournamentType.createMany({
        data: plan.tournaments.map((index) => ({ planId: row.id, tournamentTypeId: tournamentTypes[index]!.id, tenantId })),
      });
    }
  }

  // Шаблон недели залов — то, что видит администратор в «Расписании залов».
  for (const hall of halls) {
    const hallIndex = halls.indexOf(hall);
    const already = await prisma.tableClosureRule.count({ where: { tableId: { in: hall.tables } } });
    if (already > 0) continue;

    const rules: Prisma.TableClosureRuleCreateManyInput[] = [];
    for (const slot of def.trainings.filter((item) => item.hall === hallIndex)) {
      for (const weekday of slot.days) {
        for (let table = slot.tables[0]; table <= slot.tables[1]; table += 1) {
          rules.push({
            tenantId,
            tableId: hall.tables[table - 1]!,
            weekday,
            purpose: 'TRAINING',
            coachId: staff.coachIds[slot.coach]!,
            trainingTypeId: trainingTypes[slot.type]!.id,
            startMinute: minutesOf(slot.start),
            endMinute: minutesOf(slot.end),
          });
        }
      }
    }
    for (const slot of def.tournaments.filter((item) => item.hall === hallIndex)) {
      for (const weekday of slot.days) {
        for (let table = slot.tables[0]; table <= slot.tables[1]; table += 1) {
          rules.push({
            tenantId,
            tableId: hall.tables[table - 1]!,
            weekday,
            purpose: 'TOURNAMENT',
            tournamentTypeId: tournamentTypes[slot.type]!.id,
            startMinute: minutesOf(slot.start),
            endMinute: minutesOf(slot.end),
          });
        }
      }
    }
    await prisma.tableClosureRule.createMany({ data: rules });
  }

  // Публикации: приветствие собирается само, плюс новости клуба.
  await prisma.clubPost.createMany({
    data: [{ tenantId, title: `Добро пожаловать в «${def.name}»`, body: 'Добро пожаловать!', welcome: true, autoBody: true, publishedAt: new Date(Date.now() - 60 * DAY_MS) }],
    skipDuplicates: true,
  });
  for (const post of def.posts) {
    const exists = await prisma.clubPost.findFirst({ where: { tenantId, title: post.title }, select: { id: true } });
    if (!exists) {
      await prisma.clubPost.create({
        data: { tenantId, authorId: staff.ownerId, title: post.title, body: post.body, publishedAt: new Date(Date.now() - post.daysAgo * DAY_MS) },
      });
    }
  }

  return {
    def,
    tenantId,
    halls,
    coaches: staff.coachIds,
    trainingTypes,
    tournamentTypes,
    ownerId: staff.ownerId,
    adminId: staff.adminId,
    clients: [],
    kids: [],
  };
}

// ---------------------------------------------------------------------------
// Дни: сетка, мероприятия, записи

/** Раскладывает один день зала. День, уже разложенный раньше, не трогает. */
async function seedDay(club: ClubState, hallIndex: number, date: string, now: Date): Promise<number> {
  const hall = club.halls[hallIndex]!;
  const { tenantId, def } = club;
  const existing = await prisma.hallDaySchedule.findUnique({ where: { hallId_date: { hallId: hall.id, date: new Date(`${date}T00:00:00Z`) } }, select: { id: true } });
  if (existing) return 0;

  const weekday = isoWeekday(date);
  const schedule = await prisma.hallDaySchedule.create({ data: { tenantId, hallId: hall.id, date: new Date(`${date}T00:00:00Z`) }, select: { id: true } });
  const closures: Prisma.DayClosureCreateManyInput[] = [];
  const bookings: Prisma.TrainingBookingCreateManyInput[] = [];
  const registrations: Prisma.TournamentRegistrationCreateManyInput[] = [];
  const random = rng(`${def.slug}-${hall.def.name}-${date}`);

  for (const slot of def.trainings.filter((item) => item.hall === hallIndex && item.days.includes(weekday))) {
    const startsAt = instantAt(date, minutesOf(slot.start), hall.def.timezone);
    const endsAt = instantAt(date, minutesOf(slot.end), hall.def.timezone);
    const sessionId = randomUUID();
    const type = club.trainingTypes[slot.type]!;
    const coachId = club.coaches[slot.coach]!;

    await prisma.trainingSession.create({ data: { id: sessionId, tenantId, trainingTypeId: type.id, coachId, startsAt, endsAt, capacity: slot.capacity } });
    for (let table = slot.tables[0]; table <= slot.tables[1]; table += 1) {
      closures.push({
        tenantId,
        scheduleId: schedule.id,
        tableId: hall.tables[table - 1]!,
        startMinute: minutesOf(slot.start),
        endMinute: minutesOf(slot.end),
        purpose: 'TRAINING',
        coachId,
        trainingTypeId: type.id,
        trainingSessionId: sessionId,
      });
    }

    // Наполненность: от трети до полной группы, кое-где «мест нет».
    const kidsGroup = def.trainingTypes[slot.type]!.name.match(/дет/i) !== null;
    const pool = kidsGroup ? club.kids : club.clients;
    const fill = random() < 0.15 ? slot.capacity : Math.max(2, Math.round(slot.capacity * (0.35 + random() * 0.55)));
    for (const person of attendees(random, pool, Math.min(fill, slot.capacity), startsAt, now)) {
      bookings.push({ id: randomUUID(), tenantId, sessionId, clientId: person.id, priceAtBooking: type.price, createdAt: new Date(Math.min(now.getTime(), startsAt.getTime()) - (1 + random() * 5) * DAY_MS) });
    }
  }

  for (const slot of def.tournaments.filter((item) => item.hall === hallIndex && item.days.includes(weekday))) {
    const startsAt = instantAt(date, minutesOf(slot.start), hall.def.timezone);
    const endsAt = instantAt(date, minutesOf(slot.end), hall.def.timezone);
    const tournamentId = randomUUID();
    const type = club.tournamentTypes[slot.type]!;

    await prisma.tournament.create({ data: { id: tournamentId, tenantId, tournamentTypeId: type.id, startsAt, endsAt } });
    for (let table = slot.tables[0]; table <= slot.tables[1]; table += 1) {
      closures.push({ tenantId, scheduleId: schedule.id, tableId: hall.tables[table - 1]!, startMinute: minutesOf(slot.start), endMinute: minutesOf(slot.end), purpose: 'TOURNAMENT', tournamentId });
    }
    for (const person of attendees(random, club.clients, 6 + Math.floor(random() * 12), startsAt, now)) {
      registrations.push({ id: randomUUID(), tenantId, tournamentId, clientId: person.id, priceAtBooking: type.price, createdAt: new Date(Math.min(now.getTime(), startsAt.getTime()) - (1 + random() * 6) * DAY_MS) });
    }
  }

  await prisma.dayClosure.createMany({ data: closures });
  await prisma.trainingBooking.createMany({ data: bookings });
  await prisma.tournamentRegistration.createMany({ data: registrations });

  // Аренды — на последних столах зала, в часах работы этого дня.
  const open = hoursOn(hall.def.hours, weekday);
  const rentals: Prisma.TableBookingCreateManyInput[] = [];
  for (const [index, rental] of def.rentals.entries()) {
    const start = minutesOf(rental.start);
    if (!open || start < open[0] || start + rental.minutes > open[1] || random() < 0.25) continue;
    const robot = Boolean(rental.robot && hall.def.robot);
    const pricing = {
      tableHourPrice: hall.def.price * RUB,
      tableExtra30MinPrice: hall.def.extra * RUB,
      hasRobotOption: Boolean(hall.def.robot),
      robot30MinPrice: hall.def.robot ? hall.def.robot.m30 * RUB : null,
      robot60MinPrice: hall.def.robot ? hall.def.robot.m60 * RUB : null,
      robotExtra30MinPrice: hall.def.robot ? hall.def.robot.extra * RUB : null,
    };
    const startsAt = instantAt(date, start, hall.def.timezone);
    rentals.push({
      id: randomUUID(),
      tenantId,
      tableId: hall.tables[hall.tables.length - 1 - index]!,
      clientId: pick(random, startsAt > now ? club.clients.filter((person) => !DEMO_IDS.has(person.id)) : club.clients, 1)[0]!.id,
      withRobot: robot,
      startsAt,
      endsAt: new Date(startsAt.getTime() + rental.minutes * 60_000),
      priceAtBooking: quote(pricing, rental.minutes, robot).price,
      createdAt: new Date(Math.min(now.getTime(), startsAt.getTime()) - 2 * DAY_MS),
    });
  }
  await prisma.tableBooking.createMany({ data: rentals });

  return 1;
}

/**
 * Отметки прошедшего: всё, что закончилось и ещё «записан», — «пришёл»
 * (чаще) или «не пришёл», с визитом в журнале. Так же, как отметил бы
 * администратор: процент — весь при «пришёл», процент неявки клуба при
 * неявке; визит — одна строка на запись, с автором-администратором.
 */
async function markPast(club: ClubState, now: Date): Promise<number> {
  const { tenantId, adminId } = club;
  let marked = 0;

  const trainings = await prisma.trainingBooking.findMany({
    where: { tenantId, status: 'BOOKED', session: { endsAt: { lt: now } } },
    select: { id: true, clientId: true, session: { select: { startsAt: true, coachId: true } } },
  });
  const tournaments = await prisma.tournamentRegistration.findMany({
    where: { tenantId, status: 'BOOKED', tournament: { endsAt: { lt: now } } },
    select: { id: true, clientId: true, tournament: { select: { startsAt: true } } },
  });
  const tables = await prisma.tableBooking.findMany({
    where: { tenantId, status: 'BOOKED', endsAt: { lt: now } },
    select: { id: true, clientId: true, startsAt: true },
  });

  const attends = (id: string): boolean => rng(`mark-${id}`)() < 0.86;
  const visits: Prisma.VisitLogCreateManyInput[] = [];

  for (const row of trainings) {
    const attended = attends(row.id);
    await prisma.trainingBooking.update({ where: { id: row.id }, data: { status: attended ? 'ATTENDED' : 'NO_SHOW', chargeRatio: attended ? 100 : club.def.noShow } });
    visits.push({ tenantId, clientId: row.clientId, coachId: row.session.coachId, sourceType: 'TRAINING', trainingBookingId: row.id, attended, visitedAt: row.session.startsAt, recordedByUserId: adminId });
  }
  for (const row of tournaments) {
    const attended = attends(row.id);
    await prisma.tournamentRegistration.update({ where: { id: row.id }, data: { status: attended ? 'ATTENDED' : 'NO_SHOW', chargeRatio: attended ? 100 : club.def.noShow } });
    visits.push({ tenantId, clientId: row.clientId, sourceType: 'TOURNAMENT', tournamentRegistrationId: row.id, attended, visitedAt: row.tournament.startsAt, recordedByUserId: adminId });
  }
  for (const row of tables) {
    const attended = attends(row.id);
    await prisma.tableBooking.update({ where: { id: row.id }, data: { status: attended ? 'ATTENDED' : 'NO_SHOW', chargeRatio: attended ? 100 : club.def.noShow } });
    if (row.clientId) {
      visits.push({ tenantId, clientId: row.clientId, sourceType: 'TABLE', tableBookingId: row.id, attended, visitedAt: row.startsAt, recordedByUserId: adminId });
    }
  }

  await prisma.visitLog.createMany({ data: visits });
  marked += trainings.length + tournaments.length + tables.length;

  return marked;
}

/** Проданные абонементы: несколько клиентов клуба, журнал — строкой покупки. */
async function seedSubscriptions(club: ClubState, extraClientIds: string[]): Promise<void> {
  const { tenantId } = club;
  const plans = await prisma.subscriptionPlan.findMany({ where: { tenantId }, select: { id: true, visitsCount: true, durationDays: true, price: true }, orderBy: { createdAt: 'asc' } });
  if (plans.length === 0) return;

  const random = rng(`subs-${club.def.slug}`);
  const buyers = [...extraClientIds, ...pick(random, club.clients, 6).map((person) => person.id)];

  for (const [index, clientId] of buyers.entries()) {
    const has = await prisma.subscription.findFirst({ where: { tenantId, clientId }, select: { id: true } });
    if (has) continue;

    const plan = plans[index % plans.length]!;
    const purchasedAt = new Date(Date.now() - (2 + Math.floor(random() * 20)) * DAY_MS);
    const used = plan.visitsCount ? Math.min(plan.visitsCount - 1, Math.floor(random() * 4)) : 0;
    const remaining = plan.visitsCount === null ? null : plan.visitsCount - used;
    const subscription = await prisma.subscription.create({
      data: {
        tenantId,
        clientId,
        planId: plan.id,
        remainingVisits: plan.visitsCount,
        purchasedAt,
        expiresAt: plan.durationDays ? new Date(purchasedAt.getTime() + plan.durationDays * DAY_MS) : null,
        priceAtPurchase: plan.price,
        issuedByUserId: club.adminId,
        soldAtHallId: club.halls[0]!.id,
      },
      select: { id: true },
    });
    await prisma.subscriptionLedger.create({
      data: { tenantId, subscriptionId: subscription.id, delta: plan.visitsCount ?? 0, balanceAfter: plan.visitsCount, reason: 'PURCHASE', createdByUserId: club.adminId },
    });
    // Израсходованное до демо — корректировкой с причиной: журнал и кэш
    // остатка сходятся, как требует единственный писатель `writeLedger`.
    if (remaining !== null && used > 0) {
      await prisma.subscriptionLedger.create({
        data: { tenantId, subscriptionId: subscription.id, delta: -used, balanceAfter: remaining, reason: 'ADMIN_ADJUSTMENT', note: 'Визиты, списанные до перехода на КНТ', createdByUserId: club.adminId },
      });
      await prisma.subscription.update({ where: { id: subscription.id }, data: { remainingVisits: remaining } });
    }
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error('Задайте DEMO_PASSWORD (не короче 8 символов) — пароль демо-учёток для показа.');
  }
  // Пишет только в базу, в имени которой есть «demo»: боевая называется
  // просто yenisey, и демо-учётки с известным паролем там недопустимы.
  const database = /\/([^/?]+)(\?|$)/.exec(process.env.DATABASE_URL ?? '')?.[1] ?? '';
  if (!database.includes('demo')) {
    throw new Error(`База «${database}» — не демо. Демо-мир пишется только в базу с «demo» в имени.`);
  }

  const now = new Date();
  const demoHash = await hashPassword(password);

  // Демо-учётки для показа — с известным паролем.
  const platformOwner = await upsertUser({ email: `owner@${DOMAIN}`, fullName: 'Платформов Олег Викторович', gender: 'MALE', birthDate: '1983-04-12', phone: nextPhone(), passwordHash: demoHash, platformOwner: true });
  const director = await upsertUser({ email: `director@${DOMAIN}`, fullName: 'Руководов Игорь Петрович', gender: 'MALE', birthDate: '1978-09-01', phone: nextPhone(), passwordHash: demoHash });
  const manager = await upsertUser({ email: `manager@${DOMAIN}`, fullName: 'Управляева Ольга Сергеевна', gender: 'FEMALE', birthDate: '1985-02-14', phone: nextPhone(), passwordHash: demoHash });
  const admin = await upsertUser({ email: `admin@${DOMAIN}`, fullName: 'Администраторова Юлия Андреевна', gender: 'FEMALE', birthDate: '1996-06-20', phone: nextPhone(), passwordHash: demoHash });
  const player = await upsertUser({ email: `player@${DOMAIN}`, fullName: 'Игроков Максим Дмитриевич', gender: 'MALE', birthDate: '1993-11-08', phone: nextPhone(), passwordHash: demoHash });
  const parent = await upsertUser({ email: `parent@${DOMAIN}`, fullName: 'Родителева Наталья Игоревна', gender: 'FEMALE', birthDate: '1986-03-03', phone: nextPhone(), passwordHash: demoHash });
  const child = await upsertUser({ email: `child@${DOMAIN}`, fullName: 'Родителев Коля Олегович', gender: 'MALE', birthDate: `${now.getFullYear() - 10}-05-17`, phone: nextPhone(), passwordHash: demoHash });
  await ensureGuardianship(child, parent);
  for (const id of [player, parent, child]) DEMO_IDS.add(id);

  // Профиль игрока у демо-клиента — чтобы страница игрока не была пустой.
  await prisma.playerProfile.upsert({ where: { userId: player }, update: {}, create: { userId: player, blade: 'Butterfly Viscaria', forehandRubber: 'Tenergy 05', backhandRubber: 'Dignics 09C' } });
  if ((await prisma.achievement.count({ where: { userId: player } })) === 0) {
    await prisma.achievement.createMany({
      data: [
        { userId: player, title: 'Пятничное турне «Енисея»', date: new Date(now.getTime() - 40 * DAY_MS), level: 'CLUB', place: 1 },
        { userId: player, title: 'Кубок Красноярска, мужской одиночный разряд', date: new Date(now.getTime() - 200 * DAY_MS), level: 'CITY', place: 3 },
      ],
    });
  }

  const people = await seedPeople();

  // Тренеры — учётки по клубам; первый тренер «Енисея» — демо-учётка coach@.
  const clubs: ClubState[] = [];
  for (const def of CLUBS) {
    const coachIds: string[] = [];
    for (const [index, coach] of def.coaches.entries()) {
      const email = def.slug === 'yenisey' && index === 0 ? `coach@${DOMAIN}` : `coach-${def.slug}-${index + 1}@${DOMAIN}`;
      coachIds.push(await upsertUser({ email, fullName: coach.name, gender: coach.gender, birthDate: coach.born, phone: nextPhone(), passwordHash: email === `coach@${DOMAIN}` ? demoHash : NO_LOGIN }));
    }

    const yenisey = def.slug === 'yenisey';
    const ownerId = yenisey ? director : await upsertUser({ email: `owner-${def.slug}@${DOMAIN}`, fullName: `${def.coaches[0]!.name.split(' ')[0]} Николай Иванович`, gender: 'MALE', birthDate: '1975-01-01', phone: nextPhone(), passwordHash: NO_LOGIN });
    const adminId = yenisey ? admin : await upsertUser({ email: `admin-${def.slug}@${DOMAIN}`, fullName: `Сменова Алина ${def.slug === 'baikal' ? 'Олеговна' : 'Петровна'}`, gender: 'FEMALE', birthDate: '1998-02-02', phone: nextPhone(), passwordHash: NO_LOGIN });

    const club = await seedClub(def, { ownerId, adminId, managerId: yenisey ? manager : undefined, coachIds });

    // Клиенты клуба: часть общей массовки (у людей бывает несколько клубов).
    const random = rng(`clients-${def.slug}`);
    club.clients = pick(random, people.adults, yenisey ? 30 : 20);
    club.kids = pick(random, people.kids, yenisey ? 10 : 6);
    if (yenisey || def.slug === 'baikal') club.clients.push({ id: player, name: 'Игроков', child: false });
    if (yenisey) club.kids.push({ id: child, name: 'Родителев', child: true });
    for (const person of [...club.clients, ...club.kids]) {
      await ensureMember(person.id, club.tenantId, [Role.CLIENT]);
    }
    if (yenisey) await ensureMember(parent, club.tenantId, [Role.CLIENT]);
    clubs.push(club);
  }

  for (const [childId, guardianId] of people.guardians) {
    await ensureGuardianship(childId, guardianId);
  }

  // Дни: окно «4 недели назад — 3 вперёд» по часам каждого зала.
  let days = 0;
  for (const club of clubs) {
    for (const [hallIndex, hall] of club.halls.entries()) {
      const today = localDate(now, hall.def.timezone);
      for (let offset = -PAST_DAYS; offset <= FUTURE_DAYS; offset += 1) {
        days += await seedDay(club, hallIndex, addDays(today, offset), now);
      }
    }
  }

  let marked = 0;
  for (const club of clubs) {
    marked += await markPast(club, now);
  }

  for (const club of clubs) {
    await seedSubscriptions(club, club.def.slug === 'yenisey' ? [player] : []);
  }

  // «Мои клубы» и «Мои тренеры»: у демо-клиента и у части массовки.
  const slugId = new Map(clubs.map((club) => [club.def.slug, club.tenantId]));
  const favourites: [string, string[]][] = [
    [player, ['yenisey', 'baikal', 'stolby']],
    [parent, ['yenisey']],
    ...people.adults.slice(0, 20).map((person, index): [string, string[]] => [person.id, [CLUBS[index % 4]!.slug]]),
  ];
  for (const [userId, slugs] of favourites) {
    if ((await prisma.userClub.count({ where: { userId } })) > 0) continue;
    await prisma.userClub.createMany({ data: slugs.map((slug, index) => ({ userId, tenantId: slugId.get(slug)!, slot: index + 1 })) });
  }
  await prisma.userCoach.createMany({
    data: [
      { userId: player, coachId: clubs[0]!.coaches[0]! },
      { userId: player, coachId: clubs[3]!.coaches[2]! },
      { userId: parent, coachId: clubs[0]!.coaches[1]! },
    ],
    skipDuplicates: true,
  });

  // Новости платформы.
  for (const news of [
    { section: 'UPDATES' as const, title: 'Новая страница клуба', body: 'Расписание по дням, фильтр по залам, карточки тренеров во весь рост и залы с адресами и ценами.\n\n- фильтр «Все залы» в расписании\n- тренеры и мероприятия — карточками\n- бронь стола в два щелчка', daysAgo: 1 },
    { section: 'GENERAL' as const, title: 'В КНТ уже четыре клуба', body: 'К платформе присоединился КНТ «Байкал» из Иркутска. Записывайтесь на тренировки и турниры в любом клубе с одним аккаунтом.', daysAgo: 5 },
    { section: 'CLUBS' as const, title: 'Расписание персонала: шаблон недели', body: 'Руководители и управляющие задают обычную неделю смен, а замены — по дням.', daysAgo: 9 },
  ]) {
    const exists = await prisma.platformNews.findFirst({ where: { title: news.title }, select: { id: true } });
    if (!exists) {
      await prisma.platformNews.create({ data: { section: news.section, title: news.title, body: news.body, authorId: platformOwner, publishedAt: new Date(now.getTime() - news.daysAgo * DAY_MS) } });
    }
  }

  await prisma.platformPlan.createMany({
    data: [
      { id: 'platform-plan-month', name: 'Месяц', periodMonths: 1, price: 5_000 * RUB },
      { id: 'platform-plan-year', name: 'Год', periodMonths: 12, price: 50_000 * RUB },
      { id: 'platform-plan-3years', name: '3 года', periodMonths: 36, price: 130_000 * RUB },
    ],
    skipDuplicates: true,
  });

  console.log(`Демо-мир: клубов ${clubs.length}, новых дней залов ${days}, отмечено прошедших записей ${marked}.`);
  console.log(`Демо-учётки (пароль — DEMO_PASSWORD): owner@, director@, manager@, admin@, coach@, player@, parent@, child@ — на ${DOMAIN}.`);
}

main()
  .catch((error: unknown) => {
    console.error('Демо-мир не собран:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
