/**
 * Тексты уведомлений.
 *
 * Собираются в момент отправки, а не при постановке в очередь: к тому времени
 * запись могли и отменить, и сообщение по устаревшим данным хуже никакого.
 * Всё, что для текста нужно, лежит в payload строки очереди — его собирает
 * ClientNotifier, и деньги в нём уже посчитаны (`chargeOf`): второй расчёт
 * здесь разошёлся бы с итогом дня молча.
 *
 * Чистый модуль без относительных импортов — гоняется `node --test`.
 *
 * ПРАВИЛО, которое легко нарушить незаметно: персоналу о клиенте — только
 * сокращённое имя (`shortName`, «Иванов И.»), без полного имени и телефона —
 * они на экране сайта по ссылке. Решение заказчика от 23.09.2026: MAX —
 * российский сервис, и сокращённое имя в нём допустимо, а больше не нужно.
 * Клиенту — только его собственное.
 */

export interface RenderContext {
  /** Адрес сайта без косой черты в конце: https://ant-yenisey.ru. */
  webOrigin: string;
}

export interface RenderedMessage {
  text: string;
  /** Кнопка под сообщением: открывает нужный экран сайта. */
  link?: { label: string; url: string };
}

export type EntryKind = 'TABLE' | 'TRAINING' | 'TOURNAMENT';

/** Данные записи для сообщений о ней: подтверждение, отмена, напоминание, неявка. */
export interface EntryPayload {
  entry: { kind: EntryKind; id: string; startsAt: string };
  /** Название занятия или турнира; у аренды — подпись стола. */
  title: string;
  /** Зал, если известен: у занятия без сетки его нет. */
  place: string | null;
  club: string;
  timezone: string;
  /** Чья запись, если сообщение родителю: «Иванов К.». Своя — null. */
  person: string | null;
  /** Оплачено абонементом: денег за записью нет, есть визит. */
  prepaid: boolean;
  /** Цена записи, копейки. */
  price: number;
  /** Сколько к оплате по правилам клуба после отмены или неявки, копейки. */
  charge?: number;
  /** Процент, по которому посчитано `charge`. У абонемента — судьба визита: 0 или 100. */
  chargePercent?: number | null;
  /** Действие клуба, а не самого человека: отменил или записал администратор. */
  byClub?: boolean;
  /** До какого момента отмена бесплатна — для напоминания. */
  freeCancelUntil?: string | null;
}

export interface SubscriptionPayload {
  reason: 'EXPIRES' | 'LAST_VISIT' | 'NO_VISITS';
  plan: string;
  club: string;
  timezone: string;
  person: string | null;
  expiresAt: string | null;
  remainingVisits: number | null;
}

export interface RankPayload {
  decision: 'VERIFIED' | 'REJECTED';
  rank: string;
  club: string;
  reason: string | null;
}

export interface GuardianshipPayload {
  guardian: string;
}

/** Тренеру: запись или отмена в его группе. */
export interface CoachEntryPayload {
  change: 'BOOKED' | 'CANCELLED';
  person: string;
  title: string;
  startsAt: string;
  timezone: string;
  club: string;
  slug: string;
  booked: number;
  capacity: number;
}

/** Тренеру утром: его занятия на сегодня. */
export interface CoachDayPayload {
  club: string;
  slug: string;
  timezone: string;
  sessions: { startsAt: string; title: string; booked: number; capacity: number }[];
}

/** Администраторам: у мероприятия не отмечено присутствие. */
export interface EscalationPayload {
  kind: EntryKind;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  place: string | null;
  club: string;
  slug: string;
  /** Сокращённые имена тех, кто без отметки: не больше десяти. */
  people: string[];
  count: number;
}

/** Администраторам: джоба поставила неявки. */
export interface AutoNoShowPayload {
  club: string;
  slug: string;
  people: string[];
  count: number;
}

/** Администраторам: разряд ждёт проверки. */
export interface RankPendingPayload {
  person: string;
  personId: string;
  rank: string;
  club: string;
  slug: string;
}

/** Сколько имён показывать в списке: дальше — «и ещё N». */
const NAMES_SHOWN = 10;

/**
 * Текст сообщения по типу и данным.
 *
 * Тип без шаблона — ошибка программиста, а не повод отправить пустоту:
 * отправщик пометит строку неудачной и напишет причину.
 */
export function renderNotification(type: string, payload: unknown, context: RenderContext): RenderedMessage {
  const myBookings = { label: 'Мои записи', url: `${context.webOrigin}/my-bookings` };
  const cabinet = { label: 'Личный кабинет', url: `${context.webOrigin}/cabinet` };

  switch (type) {
    case 'TEST':
      return {
        text: 'Проверка связи: уведомления «Енисея» будут приходить сюда.',
        link: { label: 'Настройки уведомлений', url: `${context.webOrigin}/cabinet#notifications` },
      };

    case 'BOOKING_CONFIRMED': {
      const p = payload as EntryPayload;
      const head = p.person ? `Новая запись · ${p.person}` : p.byClub ? 'Вас записал клуб' : 'Вы записаны';

      return {
        text: lines(head, ...entryLines(p), p.prepaid ? 'Оплата — визит с абонемента.' : `Стоимость — ${rubles(p.price)}.`),
        link: myBookings,
      };
    }

    case 'BOOKING_CANCELLED': {
      const p = payload as EntryPayload;
      const head = `${p.byClub ? 'Клуб отменил запись' : 'Запись отменена'}${p.person ? ` · ${p.person}` : ''}`;

      return { text: lines(head, ...entryLines(p), cancelMoney(p)), link: myBookings };
    }

    case 'BOOKING_REMINDER': {
      const p = payload as EntryPayload;
      const head = p.person ? `Напоминание · ${p.person}` : 'Напоминание о записи';
      const until =
        !p.prepaid && p.freeCancelUntil
          ? `Отменить бесплатно можно до ${time(p.freeCancelUntil, p.timezone)}.`
          : null;

      return { text: lines(head, ...entryLines(p), until), link: myBookings };
    }

    case 'BOOKING_NO_SHOW': {
      const p = payload as EntryPayload;
      const head = `Отмечена неявка${p.person ? ` · ${p.person}` : ''}`;
      const money = p.prepaid
        ? 'Визит с абонемента списан.'
        : p.charge
          ? `По правилам клуба к оплате ${rubles(p.charge)}.`
          : 'Без списания.';

      return {
        text: lines(head, ...entryLines(p), money, 'Если это ошибка — обратитесь к администратору клуба.'),
        link: myBookings,
      };
    }

    case 'SUBSCRIPTION_ENDING': {
      const p = payload as SubscriptionPayload;
      const whose = p.person ? ` (${p.person})` : '';
      const what =
        p.reason === 'EXPIRES'
          ? `Абонемент «${p.plan}»${whose} заканчивается ${p.expiresAt ? date(p.expiresAt, p.timezone) : 'скоро'}.` +
            (p.remainingVisits !== null ? ` Осталось визитов: ${p.remainingVisits}.` : '')
          : p.reason === 'LAST_VISIT'
            ? `На абонементе «${p.plan}»${whose} остался один визит.`
            : `Визиты на абонементе «${p.plan}»${whose} закончились.`;

      return { text: lines(what, `Продлить можно у администратора клуба «${p.club}».`), link: cabinet };
    }

    case 'RANK_DECIDED': {
      const p = payload as RankPayload;
      const text =
        p.decision === 'VERIFIED'
          ? `Клуб «${p.club}» подтвердил ваш разряд: ${p.rank}.`
          : lines(`Клуб «${p.club}» не подтвердил разряд ${p.rank}.`, p.reason ? `Причина: ${p.reason}` : null);

      return { text, link: cabinet };
    }

    case 'GUARDIANSHIP_REQUESTED': {
      const p = payload as GuardianshipPayload;

      return {
        text: lines(
          `${p.guardian} просит закрепить вас за собой как ребёнка: тогда родитель сможет записывать вас и вести ваш профиль.`,
          'Согласиться или отказаться можно в личном кабинете.',
        ),
        link: cabinet,
      };
    }

    case 'COACH_ENTRY_CHANGED': {
      const p = payload as CoachEntryPayload;
      const head = p.change === 'BOOKED' ? `Запись в группу · ${p.person}` : `Отмена в группе · ${p.person}`;

      return {
        text: lines(head, `Занятие «${p.title}»`, when(p.startsAt, p.timezone), `Записано ${p.booked} из ${p.capacity}.`),
        link: { label: 'Мои группы', url: `${context.webOrigin}/clubs/${p.slug}/coach` },
      };
    }

    case 'COACH_DAY_PLAN': {
      const p = payload as CoachDayPayload;
      const rows = p.sessions.map(
        (session) => `${time(session.startsAt, p.timezone)} ${session.title} — ${session.booked} из ${session.capacity}`,
      );

      return {
        text: lines(`Сегодня у вас в клубе «${p.club}»:`, ...rows),
        link: { label: 'Мои группы', url: `${context.webOrigin}/clubs/${p.slug}/coach` },
      };
    }

    case 'ATTENDANCE_ESCALATION_HOUR': {
      const p = payload as EscalationPayload;
      const what =
        p.kind === 'TRAINING' ? `Занятие «${p.title}»` : p.kind === 'TOURNAMENT' ? `Турнир «${p.title}»` : `Аренда: ${p.title}`;

      return {
        text: lines(
          'Не отмечено присутствие',
          `${what}, ${when(p.startsAt, p.timezone)}–${time(p.endsAt, p.timezone)}${p.place ? ` · ${p.place}` : ''}`,
          `Без отметки: ${p.count} — ${names(p.people, p.count)}`,
          'Через сутки после окончания система сама поставит неявку.',
        ),
        link: { label: 'Экран смены', url: `${context.webOrigin}/clubs/${p.slug}/desk` },
      };
    }

    case 'ATTENDANCE_AUTO_NO_SHOW': {
      const p = payload as AutoNoShowPayload;

      return {
        text: lines(
          `Автоматически отмечены неявки: ${p.count}`,
          names(p.people, p.count),
          'Присутствие не отметили за сутки после окончания. Исправить можно на экране смены — с причиной.',
        ),
        link: { label: 'Экран смены', url: `${context.webOrigin}/clubs/${p.slug}/desk` },
      };
    }

    case 'RANK_PENDING': {
      const p = payload as RankPendingPayload;

      return {
        text: lines(`Разряд на проверку · ${p.person}`, `Заявлен разряд: ${p.rank}. Подтвердите или отклоните в карточке человека.`),
        link: { label: 'Карточка человека', url: `${context.webOrigin}/clubs/${p.slug}/people/${p.personId}` },
      };
    }

    default:
      throw new Error(`Нет шаблона для уведомления ${type}`);
  }
}

/** «Иванов И., Петров П. и ещё 3». */
function names(people: readonly string[], count: number): string {
  const shown = people.slice(0, NAMES_SHOWN).join(', ');
  const rest = count - Math.min(people.length, NAMES_SHOWN);

  return rest > 0 ? `${shown} и ещё ${rest}` : shown;
}

/** Что, когда, где — одинаково во всех сообщениях о записи. */
function entryLines(p: EntryPayload): string[] {
  const what =
    p.entry.kind === 'TRAINING'
      ? `Занятие «${p.title}»`
      : p.entry.kind === 'TOURNAMENT'
        ? `Турнир «${p.title}»`
        : `Аренда: ${p.title}`;

  return [what, when(p.entry.startsAt, p.timezone), `${p.place ? `${p.place} · ` : ''}клуб «${p.club}»`];
}

/** Деньги отмены: у абонемента — судьба визита, у разовой записи — сумма. */
function cancelMoney(p: EntryPayload): string {
  if (p.prepaid) {
    return p.chargePercent ? 'Визит с абонемента сгорел: отмена позже срока.' : 'Визит вернулся на абонемент.';
  }

  return p.charge
    ? `По правилам клуба к оплате ${rubles(p.charge)} (${p.chargePercent ?? 0}%).`
    : 'Бесплатно: отмена в срок.';
}

function lines(...parts: (string | null | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join('\n');
}

/** «пт, 26 сентября, 18:00» по поясу зала. */
export function when(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function time(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

function date(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: timezone, day: 'numeric', month: 'long' }).format(new Date(iso));
}

/** Копейки → «700 ₽», «350,50 ₽». */
export function rubles(kopecks: number): string {
  const whole = Math.trunc(kopecks / 100);
  const rest = Math.abs(kopecks % 100);
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  return rest === 0 ? `${grouped} ₽` : `${grouped},${rest.toString().padStart(2, '0')} ₽`;
}

/**
 * Годится ли адрес для кнопки-ссылки.
 *
 * http://localhost из разработки мессенджер открыть не может, а отвергнутая
 * кнопка валит всё сообщение. Такой адрес уходит в текст, кнопка — только на
 * https-адрес с доменом.
 */
export function buttonAllowed(url: string): boolean {
  return /^https:\/\/[^/]+\.[^/]+/.test(url);
}
