import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buttonAllowed, renderNotification } from './render.ts';

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
