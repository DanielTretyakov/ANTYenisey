import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLoopback } from './network.ts';

test('петлевые адреса распознаются во всех трёх записях', () => {
  assert.equal(isLoopback('127.0.0.1'), true);
  assert.equal(isLoopback('::1'), true);
  // Так Node отдаёт IPv4-адрес, когда сокет открыт в двойном стеке.
  assert.equal(isLoopback('::ffff:127.0.0.1'), true);
});

test('внешние адреса и отсутствующее значение петлевыми не считаются', () => {
  assert.equal(isLoopback('93.184.216.34'), false);
  // Соседний адрес той же подсети 127.0.0.0/8 — не тот, что раздаёт Node,
  // и подставить его снаружи нельзя, поэтому в наборе его нет.
  assert.equal(isLoopback('127.0.0.2'), false);
  assert.equal(isLoopback(undefined), false);
});
