import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buttonAllowed, quoted, renderNotification, rubles, type EntryPayload } from './render.ts';

const context = { webOrigin: 'https://ant-yenisey.ru' };

const training: EntryPayload = {
  entry: { kind: 'TRAINING', id: 'b1', startsAt: '2026-09-25T11:00:00.000Z' },
  title: 'Начинающие',
  place: 'Основной зал',
  club: 'Енисей',
  timezone: 'Asia/Krasnoyarsk',
  person: null,
  prepaid: false,
  price: 70_000,
};

describe('сообщения о записи', () => {
  it('подтверждение: что, когда по поясу зала, где и сколько', () => {
    const { text, link } = renderNotification('BOOKING_CONFIRMED', training, context);

    assert.match(text, /^Вы записаны/);
    assert.match(text, /Занятие «Начинающие»/);
    assert.match(text, /25 сентября/);
    assert.match(text, /18:00/);
    assert.match(text, /Основной зал · клуб «Енисей»/);
    assert.match(text, /Стоимость — 700 ₽/);
    assert.equal(link?.url, 'https://ant-yenisey.ru/my-bookings');
  });

  it('родителю — с именем ребёнка', () => {
    const { text } = renderNotification('BOOKING_CONFIRMED', { ...training, person: 'Петров К.' }, context);

    assert.match(text, /^Новая запись · Петров К\./);
  });

  it('запись администратором — так и сказано', () => {
    assert.match(renderNotification('BOOKING_CONFIRMED', { ...training, byClub: true }, context).text, /^Вас записал клуб/);
  });

  it('по абонементу — визит, а не деньги', () => {
    assert.match(renderNotification('BOOKING_CONFIRMED', { ...training, prepaid: true }, context).text, /визит с абонемента/);
  });

  it('отмена в срок — бесплатно, поздняя — сумма и процент', () => {
    assert.match(
      renderNotification('BOOKING_CANCELLED', { ...training, charge: 0, chargePercent: 0 }, context).text,
      /Бесплатно: отмена в срок/,
    );
    assert.match(
      renderNotification('BOOKING_CANCELLED', { ...training, charge: 35_000, chargePercent: 50 }, context).text,
      /к оплате 350 ₽ \(50%\)/,
    );
  });

  it('отмена клубом — так и сказано', () => {
    assert.match(renderNotification('BOOKING_CANCELLED', { ...training, byClub: true }, context).text, /^Клуб отменил запись/);
  });

  it('отмена по абонементу — судьба визита', () => {
    assert.match(
      renderNotification('BOOKING_CANCELLED', { ...training, prepaid: true, chargePercent: 0 }, context).text,
      /Визит вернулся на абонемент/,
    );
    assert.match(
      renderNotification('BOOKING_CANCELLED', { ...training, prepaid: true, chargePercent: 100 }, context).text,
      /сгорел/,
    );
  });

  it('напоминание называет срок бесплатной отмены по поясу зала', () => {
    const { text } = renderNotification(
      'BOOKING_REMINDER',
      { ...training, freeCancelUntil: '2026-09-25T10:00:00.000Z' },
      context,
    );

    assert.match(text, /Отменить бесплатно можно до 17:00/);
  });

  it('неявка — сумма и куда идти, если ошибка', () => {
    const { text } = renderNotification('BOOKING_NO_SHOW', { ...training, charge: 70_000, chargePercent: 100 }, context);

    assert.match(text, /^Отмечена неявка/);
    assert.match(text, /к оплате 700 ₽/);
    assert.match(text, /обратитесь к администратору/);
  });

  it('аренда стола', () => {
    const table = { ...training, entry: { ...training.entry, kind: 'TABLE' as const }, title: 'Стол 3' };

    assert.match(renderNotification('BOOKING_CONFIRMED', table, context).text, /Аренда: Стол 3/);
  });
});

describe('абонемент, разряд, семья', () => {
  const sub = {
    plan: 'Взрослый, 8 занятий',
    club: 'Енисей',
    timezone: 'Asia/Krasnoyarsk',
    person: null,
    expiresAt: '2026-09-26T16:59:59.999Z',
    remainingVisits: 3,
  };

  it('срок кончается — дата и остаток', () => {
    const { text } = renderNotification('SUBSCRIPTION_ENDING', { ...sub, reason: 'EXPIRES' }, context);

    assert.match(text, /заканчивается 26 сентября\. Осталось визитов: 3\./);
    assert.match(text, /у администратора клуба «Енисей»/);
  });

  it('последний визит и конец визитов', () => {
    assert.match(renderNotification('SUBSCRIPTION_ENDING', { ...sub, reason: 'LAST_VISIT' }, context).text, /остался один визит/);
    assert.match(renderNotification('SUBSCRIPTION_ENDING', { ...sub, reason: 'NO_VISITS' }, context).text, /закончились/);
  });

  it('разряд: подтверждён и отклонён с причиной', () => {
    assert.match(
      renderNotification('RANK_DECIDED', { decision: 'VERIFIED', rank: 'КМС', club: 'Енисей', reason: null }, context).text,
      /подтвердил ваш разряд: КМС/,
    );
    assert.match(
      renderNotification('RANK_DECIDED', { decision: 'REJECTED', rank: 'КМС', club: 'Енисей', reason: 'нет приказа' }, context).text,
      /Причина: нет приказа/,
    );
  });

  it('заявка родителя — кто и где ответить', () => {
    const { text } = renderNotification('GUARDIANSHIP_REQUESTED', { guardian: 'Петров О.' }, context);

    assert.match(text, /^Петров О\. просит закрепить вас/);
    assert.match(text, /в личном кабинете/);
  });
});

describe('rubles', () => {
  it('рубли с копейками и разрядами', () => {
    assert.equal(rubles(70_000), '700 ₽');
    assert.equal(rubles(35_050), '350,50 ₽');
    assert.equal(rubles(1_200_000), '12 000 ₽');
  });
});

describe('renderNotification', () => {
  const context = { webOrigin: 'https://ant-yenisey.ru' };

  it('проверочное ведёт в настройки уведомлений', () => {
    const message = renderNotification('TEST', null, context);

    assert.match(message.text, /Проверка связи/);
    assert.equal(message.link?.url, 'https://ant-yenisey.ru/cabinet#notifications');
  });

  it('тип без шаблона — ошибка, а не пустое сообщение', () => {
    assert.throws(() => renderNotification('NO_SUCH_TYPE', null, context), /Нет шаблона/);
  });
});

describe('buttonAllowed', () => {
  it('кнопка — только на https-адрес с доменом', () => {
    assert.equal(buttonAllowed('https://ant-yenisey.ru/cabinet'), true);
    assert.equal(buttonAllowed('http://localhost:3000/cabinet'), false);
    assert.equal(buttonAllowed('https://localhost/cabinet'), false);
  });
});

describe('сообщения персоналу', () => {
  it('тренеру: запись в группу — кто и сколько мест занято', () => {
    const { text, link } = renderNotification(
      'COACH_ENTRY_CHANGED',
      {
        change: 'BOOKED',
        person: 'Иванов И.',
        title: 'Начинающие',
        startsAt: '2026-09-25T11:00:00.000Z',
        timezone: 'Asia/Krasnoyarsk',
        club: 'Енисей',
        slug: 'yenisey',
        booked: 8,
        capacity: 10,
      },
      context,
    );

    assert.match(text, /^Запись в группу · Иванов И\./);
    assert.match(text, /Записано 8 из 10\./);
    assert.equal(link?.url, 'https://ant-yenisey.ru/clubs/yenisey/coach');
  });

  it('тренеру утром: занятия дня по местному времени', () => {
    const { text } = renderNotification(
      'COACH_DAY_PLAN',
      {
        club: 'Енисей',
        slug: 'yenisey',
        timezone: 'Asia/Krasnoyarsk',
        sessions: [
          { startsAt: '2026-09-25T11:00:00.000Z', title: 'Начинающие', booked: 8, capacity: 10 },
          { startsAt: '2026-09-25T13:00:00.000Z', title: 'Взрослые', booked: 3, capacity: 12 },
        ],
      },
      context,
    );

    assert.match(text, /18:00 Начинающие — 8 из 10\n20:00 Взрослые — 3 из 12/);
  });

  it('эскалация: что, когда, кто без отметки и что будет дальше', () => {
    const people = Array.from({ length: 12 }, (_, index) => `Игрок${index} И.`);
    const { text, link } = renderNotification(
      'ATTENDANCE_ESCALATION_HOUR',
      {
        kind: 'TRAINING',
        title: 'Начинающие',
        startsAt: '2026-09-25T11:00:00.000Z',
        endsAt: '2026-09-25T12:30:00.000Z',
        timezone: 'Asia/Krasnoyarsk',
        place: 'Основной зал',
        club: 'Енисей',
        slug: 'yenisey',
        people,
        count: 12,
      },
      context,
    );

    assert.match(text, /^Не отмечено присутствие/);
    assert.match(text, /18:00–19:30 · Основной зал/);
    assert.match(text, /Без отметки: 12 — .* и ещё 2/);
    assert.equal(link?.url, 'https://ant-yenisey.ru/clubs/yenisey/desk');
  });


});

describe('утренние сводки', () => {
  const club = {
    club: 'Енисей',
    slug: 'yenisey',
    timezone: 'Asia/Krasnoyarsk',
    date: '2026-09-23',
    favourites: { count: 2, total: 57, people: ['Иванов И.', 'Петрова А.'] },
    newClients: { count: 0, people: [] },
    yesterday: { attended: 14, noShows: 2, cancelled: 3, money: 1_240_000, subscriptionSales: { count: 2, amount: 900_000 } },
    unmarked: 0,
    today: { trainings: 5, booked: 38, capacity: 60, tournaments: 1, tables: 7 },
    subscriptions: { expiring: [], empty: [] },
  };

  it('клуб: вчерашние цифры, деньги и план на сегодня', () => {
    const { text, link } = renderNotification('CLUB_DIGEST', club, context);

    assert.match(text, /^Сводка клуба «Енисей» за 23 сентября/);
    assert.match(text, /Своим отметили: 2 \(всего 57\) — Иванов И\., Петрова А\./);
    assert.match(text, /Новых клиентов: 0/);
    assert.match(text, /Пришли: 14, не пришли: 2, отмен: 3/);
    assert.match(text, /Итог дня: 12\u00a0400 ₽, абонементов продано 2 на 9\u00a0000 ₽/);
    assert.match(text, /Сегодня: занятий 5 \(записано 38 из 60\), турниров 1, аренд 7/);
    assert.doesNotMatch(text, /Без отметки|Абонемент кончается|Закончились визиты/);
    assert.doesNotMatch(text, /\n\n\n/);
    assert.equal(link?.url, 'https://ant-yenisey.ru/clubs/yenisey/desk');
  });

  it('клуб: неотмеченные и абонементы — только когда есть', () => {
    const { text } = renderNotification(
      'CLUB_DIGEST',
      {
        ...club,
        unmarked: 4,
        subscriptions: {
          expiring: [{ person: 'Сидоров С.', plan: '8 занятий', expiresAt: '2026-09-25T16:59:59.999Z' }],
          empty: [{ person: 'Орлова О.', plan: '4 занятия' }],
        },
      },
      context,
    );

    assert.match(text, /Без отметки: 4/);
    assert.match(text, /Абонемент кончается в ближайшие 3 дня:\nСидоров С\. — «8 занятий» до 25 сентября/);
    assert.match(text, /Закончились визиты:\nОрлова О\. — «4 занятия»/);
  });

  it('платформа: учётки, клубы, «свои» по клубам и здоровье MAX', () => {
    const { text } = renderNotification(
      'PLATFORM_DIGEST',
      {
        date: '2026-09-23',
        users: { added: 12, total: 340 },
        clubs: { added: 0, total: 3 },
        favourites: { count: 5, byClub: [{ club: 'Енисей', count: 4 }, { club: 'Другой', count: 1 }] },
        entries: 57,
        activeClients30: 210,
        max: { linked: 45, blocked: 2, failed: 0 },
      },
      context,
    );

    assert.match(text, /^Сводка платформы за 23 сентября/);
    assert.match(text, /Учётки: \+12 \(всего 340\)/);
    assert.match(text, /Своим отметили: 5 — «Енисей» 4, «Другой» 1/);
    assert.match(text, /MAX: подключено 45, бот остановлен у 2, не доставлено за день 0/);
  });
});

describe('quoted', () => {
  it('своих кавычек нет — обернуть, есть — оставить как есть', () => {
    assert.equal(quoted('Енисей'), '«Енисей»');
    assert.equal(quoted('АНТ «Енисей»'), 'АНТ «Енисей»');
  });
});
