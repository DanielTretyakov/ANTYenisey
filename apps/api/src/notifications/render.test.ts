import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buttonAllowed, renderNotification, rubles, type EntryPayload } from './render.ts';

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
    assert.match(renderNotification('BOOKING_CONFIRMED', { ...training, byClub: true }, context).text, /^Администратор записал вас/);
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
