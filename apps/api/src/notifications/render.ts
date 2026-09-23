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
      const head = p.person ? `Новая запись · ${p.person}` : p.byClub ? 'Администратор записал вас' : 'Вы записаны';

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

    default:
      throw new Error(`Нет шаблона для уведомления ${type}`);
  }
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
