import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalize, searchHelp } from './helpSearch.ts';

const articles = [
  { slug: 'otmena', title: 'Как отменить запись и сколько это стоит', summary: 'До порога клуба — бесплатно.', keywords: ['неявка'] },
  { slug: 'rebyonok', title: 'Как записать ребёнка и отменить его запись', summary: 'За кого.', keywords: ['семья'] },
  { slug: 'stol', title: 'Как забронировать стол', summary: 'Сетка зала.', keywords: ['аренда', 'робот'] },
];

describe('searchHelp', () => {
  it('пустой запрос — все статьи по порядку', () => {
    assert.deepEqual(searchHelp(articles, '  ').map((item) => item.slug), ['otmena', 'rebyonok', 'stol']);
  });

  it('«е» вместо «ё» и регистр не важны', () => {
    assert.deepEqual(searchHelp(articles, 'РЕБЕНКА').map((item) => item.slug), ['rebyonok']);
  });

  it('нужны все слова запроса', () => {
    assert.deepEqual(searchHelp(articles, 'отменить ребенка').map((item) => item.slug), ['rebyonok']);
  });

  it('ключевые слова находят статью, хотя в заголовке их нет', () => {
    assert.deepEqual(searchHelp(articles, 'аренда').map((item) => item.slug), ['stol']);
  });

  it('совпадение в заголовке выше, чем в описании', () => {
    const list = [
      { slug: 'a', title: 'Про другое', summary: 'отмена', keywords: [] },
      { slug: 'b', title: 'Отмена', summary: '', keywords: [] },
    ];
    assert.deepEqual(searchHelp(list, 'отмена').map((item) => item.slug), ['b', 'a']);
  });

  it('знаки препинания не мешают', () => {
    assert.equal(normalize('«Мои записи» — отмена!'), 'мои записи отмена');
  });
});
