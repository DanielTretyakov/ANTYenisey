import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newsRecipients, normalizeEmail, sendProblem, signUnsubscribe, verifyUnsubscribe, type Recipient } from './mail-rules.ts';

const user = (patch: Partial<NonNullable<Recipient['user']>> = {}): NonNullable<Recipient['user']> => ({
  email: 'ivan@mail.ru',
  emailVerifiedAt: new Date('2026-10-01'),
  newsEmailConsentAt: new Date('2026-10-01'),
  deactivatedAt: null,
  ...patch,
});

describe('кому уходит письмо', () => {
  it('служебное о самой учётке — и на неподтверждённую почту', () => {
    assert.equal(sendProblem('any', 'ivan@mail.ru', { user: user({ emailVerifiedAt: null }), suppressed: [] }), null);
  });

  it('служебное по делу — только на подтверждённую', () => {
    assert.match(sendProblem('verified', 'ivan@mail.ru', { user: user({ emailVerifiedAt: null }), suppressed: [] }) ?? '', /не подтверждена/);
    assert.equal(sendProblem('verified', 'ivan@mail.ru', { user: user(), suppressed: [] }), null);
  });

  it('рассылка — подтверждение, согласие и без отписки', () => {
    assert.equal(sendProblem('news', 'ivan@mail.ru', { user: user(), suppressed: [] }), null);
    assert.match(sendProblem('news', 'ivan@mail.ru', { user: user({ newsEmailConsentAt: null }), suppressed: [] }) ?? '', /согласия/);
    assert.match(sendProblem('news', 'ivan@mail.ru', { user: user(), suppressed: ['NEWS'] }) ?? '', /отписался/);
    // Отписка от новостей служебные не трогает.
    assert.equal(sendProblem('verified', 'ivan@mail.ru', { user: user(), suppressed: ['NEWS'] }), null);
  });

  it('«не доставляется» закрывает всё, смена почты — старый адрес', () => {
    assert.ok(sendProblem('any', 'ivan@mail.ru', { user: user(), suppressed: ['ALL'] }));
    assert.match(sendProblem('any', 'old@mail.ru', { user: user(), suppressed: [] }) ?? '', /сменилась/);
    assert.ok(sendProblem('any', 'ivan@mail.ru', { user: user({ deactivatedAt: new Date() }), suppressed: [] }));
  });

  it('заявитель без учётки — только отписка решает', () => {
    assert.equal(sendProblem('news', 'club@mail.ru', { user: null, suppressed: [] }), null);
    assert.ok(sendProblem('news', 'club@mail.ru', { user: null, suppressed: ['NEWS'] }));
  });
});

describe('ссылка отписки', () => {
  const key = 'k'.repeat(40);

  it('подпись сходится, адрес — строчными', () => {
    const token = signUnsubscribe(' Ivan@Mail.ru ', 'NEWS', key);

    assert.deepEqual(verifyUnsubscribe(token, key), { email: 'ivan@mail.ru', scope: 'NEWS' });
    assert.equal(normalizeEmail(' A@B.RU '), 'a@b.ru');
  });

  it('чужой адрес с прежней подписью и чужой ключ — отказ', () => {
    const token = signUnsubscribe('ivan@mail.ru', 'NEWS', key);
    const forged = `${Buffer.from('petr@mail.ru|NEWS').toString('base64url')}.${token.split('.')[1]}`;

    assert.equal(verifyUnsubscribe(forged, key), null);
    assert.equal(verifyUnsubscribe(token, 'x'.repeat(40)), null);
    assert.equal(verifyUnsubscribe('мусор', key), null);
  });
});

describe('получатели рассылки', () => {
  it('один адрес — одно письмо, учётка важнее заявки, отписанные — мимо', () => {
    const recipients = newsRecipients({
      users: [
        { id: 'u1', email: 'Ivan@Mail.ru' },
        { id: 'u2', email: 'off@mail.ru' },
      ],
      applicants: [{ email: 'ivan@mail.ru' }, { email: 'club@mail.ru' }, { email: 'CLUB@mail.ru' }],
      suppressed: new Set(['off@mail.ru']),
    });

    assert.deepEqual(recipients, [
      { to: 'club@mail.ru', userId: null },
      { to: 'ivan@mail.ru', userId: 'u1' },
    ]);
  });
});
