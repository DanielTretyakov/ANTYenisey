import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyReply, isLinkToken, parseCommand, parseUpdate } from './max-rules.ts';

const user = { user_id: 4242, first_name: 'Иван', name: 'Иван', username: null, is_bot: false, last_activity_time: 0 };

describe('parseUpdate', () => {
  it('запуск по ссылке привязки несёт токен', () => {
    assert.deepEqual(
      parseUpdate({ update_type: 'bot_started', timestamp: 1, chat_id: 7, user, payload: 'AbCdEf0123456789_-xyz' }),
      { kind: 'started', maxUserId: 4242n, payload: 'AbCdEf0123456789_-xyz' },
    );
  });

  it('запуск без ссылки — без токена', () => {
    assert.deepEqual(parseUpdate({ update_type: 'bot_started', timestamp: 1, chat_id: 7, user, payload: null }), {
      kind: 'started',
      maxUserId: 4242n,
      payload: null,
    });
  });

  it('остановка бота и удалённый диалог — одно и то же: слать некуда', () => {
    assert.deepEqual(parseUpdate({ update_type: 'bot_stopped', timestamp: 1, chat_id: 7, user }), {
      kind: 'stopped',
      maxUserId: 4242n,
    });
    assert.deepEqual(parseUpdate({ update_type: 'dialog_removed', timestamp: 1, chat_id: 7, user }), {
      kind: 'stopped',
      maxUserId: 4242n,
    });
  });

  it('сообщение в личном диалоге', () => {
    const update = {
      update_type: 'message_created',
      timestamp: 1,
      message: {
        sender: user,
        recipient: { chat_id: 7, chat_type: 'dialog', user_id: null, post_id: null },
        timestamp: 1,
        body: { mid: 'm', seq: 1, text: '/stop' },
      },
    };

    assert.deepEqual(parseUpdate(update), { kind: 'message', maxUserId: 4242n, text: '/stop' });
  });

  it('сообщение в группе — не наше', () => {
    const update = {
      update_type: 'message_created',
      timestamp: 1,
      message: {
        sender: user,
        recipient: { chat_id: 7, chat_type: 'chat', user_id: null, post_id: null },
        timestamp: 1,
        body: { mid: 'm', seq: 1, text: 'привет' },
      },
    };

    assert.equal(parseUpdate(update), null);
  });

  it('идентификатор за пределами точности и мусор отвергаются', () => {
    assert.equal(parseUpdate({ update_type: 'bot_started', user: { user_id: 2 ** 60 } }), null);
    assert.equal(parseUpdate({ update_type: 'bot_started', user: { user_id: '4242' } }), null);
    assert.equal(parseUpdate(null), null);
    assert.equal(parseUpdate({ update_type: 'chat_title_changed', user }), null);
  });
});

describe('parseCommand', () => {
  it('стоп — по-английски и по-русски', () => {
    assert.deepEqual(parseCommand('/stop'), { name: 'stop' });
    assert.deepEqual(parseCommand('  Стоп '), { name: 'stop' });
  });

  it('всё прочее — просьба о помощи', () => {
    assert.deepEqual(parseCommand('привет'), { name: 'help' });
    assert.deepEqual(parseCommand(''), { name: 'help' });
  });
});

describe('isLinkToken', () => {
  it('наш токен — да, мусор — нет', () => {
    assert.equal(isLinkToken('AbCdEf0123456789_-xyzAbCdEf01234'), true);
    assert.equal(isLinkToken('короткий'), false);
    assert.equal(isLinkToken("' OR 1=1 --"), false);
    assert.equal(isLinkToken('a'.repeat(129)), false);
  });
});

describe('classifyReply', () => {
  it('2xx — отправлено', () => {
    assert.deepEqual(classifyReply(200, null), { kind: 'sent' });
  });

  it('403 и 404 — бот остановлен или диалога нет, повторять незачем', () => {
    assert.equal(classifyReply(403, { code: 'chat.denied', message: 'dialog is suspended' }).kind, 'blocked');
    assert.equal(classifyReply(404, { code: 'not.found', message: 'user not found' }).kind, 'blocked');
  });

  it('лимит, сбой MAX, обрыв сети и неверный токен — повторяем', () => {
    assert.equal(classifyReply(429, { code: 'too.many.requests', message: '' }).kind, 'retry');
    assert.equal(classifyReply(502, null).kind, 'retry');
    assert.equal(classifyReply(0, null).kind, 'retry');
    assert.equal(classifyReply(401, { code: 'verify.token', message: 'Invalid access_token' }).kind, 'retry');
  });

  it('прочие 4xx — ошибка в нашем запросе', () => {
    const outcome = classifyReply(400, { code: 'proto.payload', message: 'text: too long' });

    assert.deepEqual(outcome, { kind: 'fatal', error: '400: proto.payload text: too long' });
  });
});
