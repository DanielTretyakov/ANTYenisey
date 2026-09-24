import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyPush, combinePush, toPushPayload } from './push-rules.ts';

const context = { webOrigin: 'https://ant-yenisey.ru', tag: 'n1' };

describe('toPushPayload', () => {
  it('первая строка — заголовок, остальное — текст без пустых строк', () => {
    const payload = toPushPayload(
      { text: 'Вы записаны\nЗанятие «Начинающие»\n\nсб, 26 сентября в 18:00', link: { url: 'https://ant-yenisey.ru/my-bookings' } },
      context,
    );

    assert.deepEqual(payload, {
      title: 'Вы записаны',
      body: 'Занятие «Начинающие»\nсб, 26 сентября в 18:00',
      url: 'https://ant-yenisey.ru/my-bookings',
      tag: 'n1',
    });
  });

  it('однострочное — под заголовком «Енисей», без кнопки ведёт на сайт', () => {
    const payload = toPushPayload({ text: 'Проверка связи.' }, context);

    assert.equal(payload.title, 'Енисей');
    assert.equal(payload.body, 'Проверка связи.');
    assert.equal(payload.url, 'https://ant-yenisey.ru');
  });

  it('длинное обрезается с многоточием', () => {
    const payload = toPushPayload({ text: `Сводка\n${'я'.repeat(2000)}` }, context);

    assert.equal(payload.body.length, 1000);
    assert.ok(payload.body.endsWith('…'));
  });
});

describe('classifyPush', () => {
  it('201 — доставлено', () => {
    assert.deepEqual(classifyPush(201), { kind: 'sent' });
  });

  it('404 и 410 — подписки больше нет', () => {
    assert.equal(classifyPush(410, 'push subscription has unsubscribed or expired').kind, 'gone');
    assert.equal(classifyPush(404).kind, 'gone');
  });

  it('лимит, сбой службы и обрыв сети — повторить', () => {
    assert.equal(classifyPush(429).kind, 'retry');
    assert.equal(classifyPush(503).kind, 'retry');
    assert.equal(classifyPush(0).kind, 'retry');
  });

  it('чужой ключ и слишком длинное — ошибка в нашем запросе', () => {
    assert.equal(classifyPush(403).kind, 'fatal');
    assert.equal(classifyPush(413).kind, 'fatal');
  });
});

describe('combinePush', () => {
  it('дошло хоть до одного устройства — отправлено', () => {
    assert.deepEqual(combinePush([{ kind: 'gone', error: 'x' }, { kind: 'sent' }]), { kind: 'sent' });
  });

  it('никуда не дошло, но можно повторить — повтор важнее отказа', () => {
    assert.equal(combinePush([{ kind: 'fatal', error: 'a' }, { kind: 'retry', error: 'b' }]).kind, 'retry');
  });

  it('все подписки отозваны — слать некуда', () => {
    assert.equal(combinePush([{ kind: 'gone', error: 'x' }]).kind, 'skipped');
    assert.equal(combinePush([]).kind, 'skipped');
  });
});
