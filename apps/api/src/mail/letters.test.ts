import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeHtml, LETTER_AUDIENCE, renderLetter, safeUrl, type LetterTemplate } from './letters.ts';

const ctx = { webOrigin: 'https://ant-yenisey.ru', operator: null };

describe('вёрстка письма', () => {
  it('пользовательский текст экранируется', () => {
    assert.equal(escapeHtml('<script>"x" & \'y\''), '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;');

    const letter = renderLetter('APPLICATION_RECEIVED', { contactName: 'Иванов <b>Пётр</b>', clubName: 'Клуб "Х"' }, ctx);

    assert.doesNotMatch(letter.html, /<b>Пётр/);
    assert.match(letter.html, /&lt;b&gt;Пётр/);
  });

  it('ссылка — только http(s)', () => {
    assert.equal(safeUrl('javascript:alert(1)'), '#');
    assert.equal(safeUrl('https://ant-yenisey.ru/x'), 'https://ant-yenisey.ru/x');
  });

  it('у каждого письма есть текстовая версия со ссылкой кнопки', () => {
    const letter = renderLetter('PASSWORD_RESET', { name: 'Иванов Пётр Сергеевич', token: 'abc' }, ctx);

    assert.match(letter.text, /Здравствуйте, Пётр!/);
    assert.match(letter.text, /Задать новый пароль: https:\/\/ant-yenisey\.ru\/reset-password\?token=abc/);
    assert.doesNotMatch(letter.text, /</);
  });

  it('отписка — только у рассылки', () => {
    const news = renderLetter(
      'NEWS',
      { newsId: 'n1', title: 'Обновление', body: '**Новое** в сетке\n\n- быстрый выбор', section: 'UPDATES' },
      { ...ctx, unsubscribeUrl: 'https://ant-yenisey.ru/api/mail/unsubscribe?t=x' },
    );
    const service = renderLetter('VERIFY_EMAIL', { name: 'Пётр', token: 't' }, ctx);

    assert.match(news.html, /Отписаться от рассылки/);
    assert.match(news.html, /<strong>Новое<\/strong>/);
    assert.match(news.text, /— быстрый выбор/);
    assert.doesNotMatch(service.html, /Отписаться/);
  });

  it('оператор не задан — «уточняется»', () => {
    assert.match(renderLetter('VERIFY_EMAIL', { name: 'Пётр', token: 't' }, ctx).text, /Оператор: уточняется/);
  });
});

describe('кому уходит письмо', () => {
  it('служебные о самой учётке — на любую почту, по делу — только на подтверждённую, рассылка — с согласием', () => {
    const any: LetterTemplate[] = ['VERIFY_EMAIL', 'PASSWORD_RESET', 'PASSWORD_CHANGED'];

    assert.ok(any.every((template) => LETTER_AUDIENCE[template] === 'any'));
    assert.equal(LETTER_AUDIENCE.BILLING_DOCUMENT, 'verified');
    assert.equal(LETTER_AUDIENCE.NEWS, 'news');
  });
});

describe('шаблоны', () => {
  it('подписка — сумма в рублях и дата по поясу клуба', () => {
    const letter = renderLetter(
      'SUBSCRIPTION',
      { variant: 'PAID', club: 'АНТ «Енисей»', slug: 'yenisey', timezone: 'Asia/Krasnoyarsk', until: '2026-11-30T17:00:00.000Z', plan: 'Месяц', amount: 290_000 },
      ctx,
    );

    assert.match(letter.subject, /оплачена/);
    // formatRubles ставит неразрывные пробелы — и в тысячах, и перед знаком.
    assert.match(letter.text, /Сумма: 2\s900\s₽/);
    assert.match(letter.text, /1 декабря 2026/);
  });

  it('счёт — ссылка на страницу документа', () => {
    const letter = renderLetter(
      'BILLING_DOCUMENT',
      { kind: 'INVOICE', club: 'Столбы', slug: 'stolby', documentId: 'p1', number: '12', amount: 290_000 },
      ctx,
    );

    assert.match(letter.text, /\/clubs\/stolby\/billing\/documents\/INVOICE\/p1/);
  });
});
