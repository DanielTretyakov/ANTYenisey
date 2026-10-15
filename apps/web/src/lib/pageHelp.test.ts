import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { normalizePath, pageHelpSlugs, quickHelpHidden } from './pageHelp.ts';

describe('pageHelpSlugs', () => {
  it('код клуба на выбор не влияет', () => {
    assert.deepEqual(pageHelpSlugs('/clubs/yenisey/booking'), pageHelpSlugs('/clubs/stolby/booking'));
    assert.equal(pageHelpSlugs('/clubs/yenisey/booking')[0], 'bron-stola');
  });

  it('подстраница клуба точнее страницы клуба', () => {
    assert.equal(pageHelpSlugs('/clubs/yenisey')[0], 'zapis-na-zanyatie');
    assert.equal(pageHelpSlugs('/clubs/yenisey/schedule')[0], 'raspisanie-zala');
    assert.equal(pageHelpSlugs('/clubs/yenisey/people/abc')[0], 'lyudi-kluba');
  });

  it('«Мои группы» — раньше карточки тренера', () => {
    assert.equal(pageHelpSlugs('/clubs/yenisey/coach/groups')[0], 'moi-gruppy');
    assert.equal(pageHelpSlugs('/clubs/yenisey/coach')[0], 'kartochka-trenera');
  });

  it('раздел кабинета точнее кабинета', () => {
    assert.deepEqual(pageHelpSlugs('/cabinet/edit/notifications'), ['uvedomleniya']);
    assert.equal(pageHelpSlugs('/cabinet')[0], 'profil-igroka');
  });

  it('хвостовая косая черта не мешает', () => {
    assert.deepEqual(pageHelpSlugs('/my-bookings/'), pageHelpSlugs('/my-bookings'));
    assert.equal(normalizePath('/clubs/yenisey/booking/'), '/clubs/*/booking');
  });

  it('у незнакомой страницы — общие статьи', () => {
    assert.deepEqual(pageHelpSlugs('/legal/privacy'), ['odin-akkaunt', 'najti-klub', 'zapis-na-zanyatie']);
  });

  it('все статьи из таблицы есть в справке', () => {
    const dir = join(import.meta.dirname, '..', 'content', 'help');
    const known = new Set(
      readdirSync(dir)
        .filter((file) => file.endsWith('.tsx'))
        .flatMap((file) => [...readFileSync(join(dir, file), 'utf8').matchAll(/slug: '([^']+)'/g)].map((match) => match[1])),
    );
    const paths = [
      '/', '/clubs/x', '/clubs/x/booking', '/clubs/x/rating', '/clubs/x/news', '/clubs/x/desk', '/clubs/x/schedule',
      '/clubs/x/staff', '/clubs/x/subscriptions', '/clubs/x/posts', '/clubs/x/people', '/clubs/x/settings',
      '/clubs/x/billing', '/clubs/x/catalog', '/clubs/x/coach', '/clubs/x/coach/groups', '/my-bookings', '/cabinet',
      '/cabinet/edit/notifications', '/cabinet/edit/clubs', '/coaches/1', '/players/1', '/for-clubs', '/platform/clubs',
      '/register', '/login', '/legal',
    ];

    for (const path of paths) {
      for (const slug of pageHelpSlugs(path)) {
        assert.ok(known.has(slug), `${path}: статьи «${slug}» нет в справке`);
      }
    }
  });
});

describe('quickHelpHidden', () => {
  it('в справке и в документах для печати кнопки нет', () => {
    assert.equal(quickHelpHidden('/help'), true);
    assert.equal(quickHelpHidden('/help/bron-stola'), true);
    assert.equal(quickHelpHidden('/clubs/yenisey/billing/documents/act/1'), true);
  });

  it('на остальных страницах есть', () => {
    assert.equal(quickHelpHidden('/'), false);
    assert.equal(quickHelpHidden('/clubs/yenisey/billing'), false);
    assert.equal(quickHelpHidden('/helpers'), false);
  });
});
