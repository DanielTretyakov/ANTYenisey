/**
 * Приветствие клуба (решение владельца от 30.09.2026): закреплённая первая
 * публикация ленты. Пока клуб не написал своё, текст собирается отсюда при
 * каждом чтении — из залов, адресов, часов работы, цен и контактов — и сам
 * следует за правками настроек.
 *
 * Чистый модуль под тестами — без относительных импортов (см. CLAUDE.md).
 * Текст — в разметке новостей (`parseMarkup`): жирный и списки.
 */

import { workingHoursLines, type WorkingHours } from '@yenisey/types';

export interface WelcomeHall {
  name: string;
  city: string | null;
  address: string | null;
  workingHours: WorkingHours | null;
  /** Копейки. */
  tableHourPrice: number;
  phone: string | null;
}

export interface WelcomeClub {
  name: string;
  halls: WelcomeHall[];
  phone: string | null;
  email: string | null;
  vkUrl: string | null;
  maxUrl: string | null;
  hasCoaches: boolean;
  hasPlans: boolean;
}

/** Предел заголовка — CHECK `ClubPost_title_sane`. */
const TITLE_MAX = 160;

export function welcomeTitle(clubName: string): string {
  const title = `Добро пожаловать в «${clubName.trim()}»`;

  return title.length <= TITLE_MAX ? title : `${title.slice(0, TITLE_MAX - 1)}…`;
}

export function defaultWelcome(club: WelcomeClub): { title: string; body: string } {
  const blocks: string[] = [`Рады видеть вас в клубе «${club.name.trim()}»! Здесь — всё, чтобы прийти и поиграть.`];

  blocks.push(hallsBlock(club.halls));
  blocks.push(howToBlock(club));

  const contacts = contactsBlock(club);
  if (contacts) blocks.push(contacts);

  blocks.push('До встречи за столом!');

  return { title: welcomeTitle(club.name), body: blocks.join('\n\n') };
}

function hallsBlock(halls: WelcomeHall[]): string {
  if (halls.length === 0) {
    return '**Где мы играем.** Залы клуб пока не указал — уточняйте по телефону.';
  }

  const cities = [...new Set(halls.map((hall) => hall.city).filter((city): city is string => !!city))];
  const count = halls.length === 1 ? 'Один зал' : `${halls.length} ${plural(halls.length, 'зал', 'зала', 'залов')}`;
  const where = cities.length > 0 ? ` (${cities.join(', ')})` : '';

  return [`**Где мы играем.** ${count}${where}:`, ...halls.map((hall) => `- ${hallLine(hall)}`)].join('\n');
}

function hallLine(hall: WelcomeHall): string {
  const parts = [`**${hall.name.trim()}** — ${placeOf(hall)}`];
  const hours = workingHoursLines(hall.workingHours);

  if (hours.length > 0) parts.push(`часы работы: ${hours.join(', ')}`);
  parts.push(`стол — ${rubles(hall.tableHourPrice)} в час`);
  if (hall.phone) parts.push(`телефон зала ${hall.phone}`);

  return parts.join('; ');
}

/**
 * Где зал. Город — только если его ещё нет в адресе: DaData пишет
 * «г Красноярск, ул …», и «Красноярск, г Красноярск» читалось бы ошибкой.
 */
function placeOf(hall: WelcomeHall): string {
  if (!hall.address) {
    return hall.city ? `${hall.city}, адрес уточняйте у клуба` : 'адрес уточняйте у клуба';
  }

  const repeats = hall.city !== null && hall.address.toLowerCase().includes(hall.city.toLowerCase());

  return repeats || !hall.city ? hall.address : `${hall.city}, ${hall.address}`;
}

function howToBlock(club: WelcomeClub): string {
  const lines = ['**Как записаться.**'];

  if (club.halls.length > 0) {
    lines.push('- Стол — кнопкой «Забронировать стол» на этой странице: зал, день, время, и готово.');
  }

  lines.push('- Тренировки и турниры — в блоке «Предстоящие»: запись в одно нажатие.');

  if (club.hasCoaches) lines.push('- Тренеры клуба и их цены — на вкладке «Тренеры».');
  if (club.hasPlans) lines.push('- Абонементы — на вкладке «Абонементы», купить можно у администратора.');

  return lines.join('\n');
}

function contactsBlock(club: WelcomeClub): string | null {
  const lines: string[] = [];

  if (club.phone) lines.push(`- Телефон: ${club.phone}`);
  if (club.email) lines.push(`- Почта: ${club.email}`);
  if (club.vkUrl) lines.push(`- ВКонтакте: ${club.vkUrl}`);
  if (club.maxUrl) lines.push(`- MAX: ${club.maxUrl}`);

  return lines.length > 0 ? ['**Связаться с клубом.**', ...lines].join('\n') : null;
}

/** 80000 → «800 ₽», 80050 → «800,50 ₽». */
function rubles(kopecks: number): string {
  const whole = kopecks % 100 === 0;

  return `${new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(kopecks / 100)} ₽`;
}

function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const units = count % 10;

  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  if (units >= 2 && units <= 4) return few;

  return many;
}
