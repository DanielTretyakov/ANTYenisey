import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseMarkup } from '@yenisey/types';
import { defaultWelcome, welcomeTitle, type WelcomeClub } from './welcome-rules.ts';

const club = (patch: Partial<WelcomeClub> = {}): WelcomeClub => ({
  name: 'Енисей',
  halls: [
    {
      name: 'Зал на Пирогова',
      city: 'Красноярск',
      address: 'г Красноярск, ул Пирогова, д 1',
      workingHours: [
        ...[0, 1, 2, 3, 4].map(() => ({ open: '08:00', close: '23:00' })),
        { open: '10:00', close: '22:00' },
        null,
      ],
      tableHourPrice: 80000,
      phone: null,
    },
    { name: 'Баки', city: 'Абакан', address: null, workingHours: null, tableHourPrice: 60050, phone: '+7 900 000-00-00' },
  ],
  phone: '+7 391 000-00-00',
  email: 'club@example.ru',
  vkUrl: 'https://vk.com/yenisey',
  maxUrl: null,
  hasCoaches: true,
  hasPlans: false,
  ...patch,
});

describe('defaultWelcome', () => {
  it('залы с городами, адресами, часами и ценами', () => {
    const { title, body } = defaultWelcome(club());

    assert.equal(title, 'Добро пожаловать в «Енисей»');
    assert.match(body, /2 зала \(Красноярск, Абакан\)/);
    // Город уже в адресе — не повторяется.
    assert.match(body, /\*\*Зал на Пирогова\*\* — г Красноярск, ул Пирогова, д 1;/);
    assert.match(body, /часы работы: Пн–Пт 08:00–23:00, Сб 10:00–22:00, Вс выходной/);
    assert.match(body, /стол — 800 ₽ в час/);
    assert.match(body, /Абакан, адрес уточняйте у клуба/);
    assert.match(body, /600,50 ₽/);
    assert.match(body, /телефон зала \+7 900 000-00-00/);
  });

  it('пустое пропускается: нет абонементов, MAX и почты', () => {
    const { body } = defaultWelcome(club({ email: null }));

    assert.doesNotMatch(body, /Абонементы/);
    assert.doesNotMatch(body, /MAX/);
    assert.doesNotMatch(body, /Почта/);
    assert.match(body, /вкладке «Тренеры»/);
  });

  it('без залов и контактов — честно и без брони стола', () => {
    const { body } = defaultWelcome(
      club({ halls: [], phone: null, email: null, vkUrl: null, hasCoaches: false }),
    );

    assert.match(body, /Залы клуб пока не указал/);
    assert.doesNotMatch(body, /Забронировать стол/);
    assert.doesNotMatch(body, /Связаться/);
  });

  it('один зал — «Один зал»', () => {
    const { body } = defaultWelcome(club({ halls: [club().halls[0]!] }));

    assert.match(body, /Один зал \(Красноярск\):/);
  });

  it('разбирается разметкой новостей: абзацы и списки', () => {
    const kinds = parseMarkup(defaultWelcome(club()).body).map((block) => block.kind);

    assert.deepEqual(kinds, ['paragraph', 'paragraph', 'list', 'paragraph', 'list', 'paragraph', 'list', 'paragraph']);
  });
});

describe('welcomeTitle', () => {
  it('длинное название обрезается под CHECK', () => {
    assert.ok(welcomeTitle('Я'.repeat(300)).length <= 160);
  });
});
