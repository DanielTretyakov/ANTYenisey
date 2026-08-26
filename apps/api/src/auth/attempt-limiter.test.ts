import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AttemptLimiter, attemptKey } from './attempt-limiter.ts';

/** Ограничитель с управляемыми часами: ждать реальное окно в тесте незачем. */
function limiter(maxAttempts = 3, windowMs = 60_000) {
  let clock = 1_000_000;
  const instance = new AttemptLimiter({ maxAttempts, windowMs, now: () => clock });

  return { instance, advance: (ms: number) => (clock += ms) };
}

test('до исчерпания лимита попытки разрешены', () => {
  const { instance } = limiter(3);

  instance.registerFailure('k');
  instance.registerFailure('k');

  assert.equal(instance.retryAfterMs('k'), null);
});

test('на исчерпании лимита вход закрывается', () => {
  const { instance } = limiter(3);

  for (let i = 0; i < 3; i += 1) instance.registerFailure('k');

  assert.equal(instance.retryAfterMs('k'), 60_000);
});

test('окно скользит: блокировка снимается, когда старейший провал из него выпал', () => {
  const { instance, advance } = limiter(3, 60_000);

  instance.registerFailure('k');
  advance(30_000);
  instance.registerFailure('k');
  instance.registerFailure('k');

  // Осталось 30 секунд до того, как первый провал выпадет из окна.
  assert.equal(instance.retryAfterMs('k'), 30_000);

  advance(30_001);
  assert.equal(instance.retryAfterMs('k'), null);
});

test('упорный перебор не держит владельца учётки заблокированным вечно', () => {
  const { instance, advance } = limiter(3, 60_000);

  for (let i = 0; i < 3; i += 1) instance.registerFailure('k');

  // Бот продолжает долбиться уже после блокировки.
  advance(59_000);
  instance.registerFailure('k');
  instance.registerFailure('k');

  // Разблокировка всё равно наступает по старейшему провалу, а не по
  // последнему: иначе бот отодвигал бы её бесконечно.
  advance(1_001);
  assert.equal(instance.retryAfterMs('k'), null);
});

test('удачный вход обнуляет счётчик: забывчивый человек — не перебор', () => {
  const { instance } = limiter(3);

  instance.registerFailure('k');
  instance.registerFailure('k');
  instance.reset('k');
  instance.registerFailure('k');

  assert.equal(instance.retryAfterMs('k'), null);
});

test('счётчики разных учёток не смешиваются', () => {
  const { instance } = limiter(2);

  instance.registerFailure('a');
  instance.registerFailure('a');

  assert.notEqual(instance.retryAfterMs('a'), null);
  assert.equal(instance.retryAfterMs('b'), null);
});

test('ключ учитывает клуб: один адрес почты может принадлежать разным людям', () => {
  assert.notEqual(attemptKey('yenisey', 'i@example.com'), attemptKey('other', 'i@example.com'));
  // Регистр и пробелы не должны давать перебирающему новый счётчик.
  assert.equal(attemptKey('yenisey', ' I@Example.com '), attemptKey('yenisey', 'i@example.com'));
});
