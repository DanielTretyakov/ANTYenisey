import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blankToNull, contactsProblem, isBotSubmission } from './application-rules.ts';

describe('заявка клуба', () => {
  it('без телефона и почты не принимается', () => {
    assert.ok(contactsProblem({}));
    assert.ok(contactsProblem({ phone: '  ', email: '' }));
  });

  it('хватает одного контакта', () => {
    assert.equal(contactsProblem({ phone: '+79991234567' }), null);
    assert.equal(contactsProblem({ email: 'club@example.ru' }), null);
  });

  it('заполненная ловушка — бот', () => {
    assert.equal(isBotSubmission('https://spam.example'), true);
    assert.equal(isBotSubmission(''), false);
    assert.equal(isBotSubmission('   '), false);
    assert.equal(isBotSubmission(undefined), false);
  });

  it('пустое поле формы — null, края срезаны', () => {
    assert.equal(blankToNull('  '), null);
    assert.equal(blankToNull(undefined), null);
    assert.equal(blankToNull('  Столбы '), 'Столбы');
  });
});
