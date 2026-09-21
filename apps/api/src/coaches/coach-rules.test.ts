import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkPriceNote, checkText, cleanText, parseSocialLinks, readSocialLinks } from './coach-rules.ts';

describe('cleanText', () => {
  it('пусто и пробелы — это null', () => {
    assert.equal(cleanText('  '), null);
    assert.equal(cleanText(''), null);
    assert.equal(cleanText(undefined), null);
    assert.equal(cleanText(' Мастер спорта '), 'Мастер спорта');
  });
});

describe('checkText', () => {
  it('слишком длинное поле называет себя', () => {
    const decision = checkText('achievements', 'я'.repeat(2001));

    assert.equal(decision.ok, false);
    assert.match((decision as { message: string }).message, /Достижения/);
  });

  it('на границе длины принимается', () => {
    assert.deepEqual(checkText('inventory', 'я'.repeat(1000)), { ok: true, value: 'я'.repeat(1000) });
  });
});

describe('checkPriceNote', () => {
  it('пусто — это null, а не пустая строка', () => {
    assert.deepEqual(checkPriceNote('   '), { ok: true, value: null });
  });

  it('слишком длинная приписка не проходит', () => {
    assert.equal(checkPriceNote('я'.repeat(301)).ok, false);
  });
});

describe('parseSocialLinks', () => {
  it('не присланное поле — пустой список, а не отказ', () => {
    assert.deepEqual(parseSocialLinks(undefined), { ok: true, links: [] });
  });

  it('javascript: в адресе не проходит', () => {
    const decision = parseSocialLinks([{ label: 'Сайт', url: 'javascript:alert(1)' }]);

    assert.equal(decision.ok, false);
  });

  it('подпись или адрес без второй половины не проходят', () => {
    assert.equal(parseSocialLinks([{ label: 'Сайт', url: '  ' }]).ok, false);
    assert.equal(parseSocialLinks([{ label: '', url: 'https://a.ru' }]).ok, false);
  });

  it('больше десяти ссылок не принимается', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ label: `С${i}`, url: 'https://a.ru' }));

    assert.equal(parseSocialLinks(many).ok, false);
  });

  it('пробелы по краям срезаются', () => {
    assert.deepEqual(parseSocialLinks([{ label: ' ВК ', url: ' https://vk.com/a ' }]), {
      ok: true,
      links: [{ label: 'ВК', url: 'https://vk.com/a' }],
    });
  });
});

describe('readSocialLinks', () => {
  it('негодное из базы отбрасывается, а не роняет страницу', () => {
    assert.deepEqual(readSocialLinks('строка'), []);
    assert.deepEqual(readSocialLinks([null, 42, { label: 'A' }, { label: 'B', url: 'javascript:1' }]), []);
  });

  it('годные ссылки читаются', () => {
    assert.deepEqual(readSocialLinks([{ label: 'ВК', url: 'https://vk.com/a' }]), [
      { label: 'ВК', url: 'https://vk.com/a' },
    ]);
  });
});
