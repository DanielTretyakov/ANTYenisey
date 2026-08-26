import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shortName } from './names.ts';

describe('shortName', () => {
  it('оставляет фамилию и инициал имени', () => {
    assert.equal(shortName('Тренеров Иван Петрович'), 'Тренеров И.');
    assert.equal(shortName('Спаррингов Сергей Иванович'), 'Спаррингов С.');
  });

  it('обходится без отчества', () => {
    assert.equal(shortName('Иванов Пётр'), 'Иванов П.');
  });

  it('одно слово отдаёт целиком', () => {
    // Обрезать единственное слово до буквы значит потерять то, что вообще
    // различает людей в списке.
    assert.equal(shortName('Иванов'), 'Иванов');
  });

  it('терпит лишние пробелы', () => {
    assert.equal(shortName('  Иванов   Иван  '), 'Иванов И.');
  });

  it('на пустой строке возвращает пустую, а не падает', () => {
    assert.equal(shortName(''), '');
    assert.equal(shortName('   '), '');
  });

  it('инициал приводится к верхнему регистру', () => {
    assert.equal(shortName('иванов иван'), 'иванов И.');
  });
});
