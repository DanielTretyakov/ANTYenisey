import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { vapidKeyBytes } from './push.ts';

describe('vapidKeyBytes', () => {
  it('base64url без выравнивания → те же байты, что у обычного base64', () => {
    // «>?>» в base64 — «Pj8+», в base64url — «Pj8-».
    assert.deepEqual([...vapidKeyBytes('Pj8-')], [0x3e, 0x3f, 0x3e]);
    assert.deepEqual([...vapidKeyBytes('_w')], [0xff]);
  });

  it('открытый ключ VAPID — 65 байт несжатой точки P-256, первый 0x04', () => {
    const key = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
    const bytes = vapidKeyBytes(key);

    assert.equal(bytes.length, 65);
    assert.equal(bytes[0], 0x04);
  });
});
