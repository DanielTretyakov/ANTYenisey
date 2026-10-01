import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseInline, parseMarkup, plainText } from '@yenisey/types';

describe('parseInline', () => {
  it('жирный, курсив, подчёркнутый', () => {
    assert.deepEqual(parseInline('a **b** *c* __d__'), [
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' ' },
      { text: 'c', italic: true },
      { text: ' ' },
      { text: 'd', underline: true },
    ]);
  });

  it('вложенность: жирный внутри курсива', () => {
    assert.deepEqual(parseInline('*a **b** c*'), [
      { text: 'a ', italic: true },
      { text: 'b', italic: true, bold: true },
      { text: ' c', italic: true },
    ]);
  });

  it('«***слово***» — жирный курсив', () => {
    assert.deepEqual(parseInline('***Здесь*** и'), [{ text: 'Здесь', bold: true, italic: true }, { text: ' и' }]);
  });

  it('пометка без пары остаётся текстом', () => {
    assert.deepEqual(parseInline('5 * 3 = 15'), [{ text: '5 * 3 = 15' }]);
    assert.deepEqual(parseInline('**без конца'), [{ text: '**без конца' }]);
  });

  it('внутри слова пометка не срабатывает', () => {
    assert.deepEqual(parseInline('snake__case__name'), [{ text: 'snake__case__name' }]);
    assert.deepEqual(parseInline('2*3*4'), [{ text: '2*3*4' }]);
  });

  it('пробел сразу за открывающей — не пометка', () => {
    assert.deepEqual(parseInline('** a**'), [{ text: '** a**' }]);
  });

  it('HTML — просто текст', () => {
    assert.deepEqual(parseInline('<script>x</script>'), [{ text: '<script>x</script>' }]);
  });
});

describe('parseMarkup', () => {
  it('абзацы и список', () => {
    const blocks = parseMarkup('Вступление\n\n- один\n- **два**\n\nКонец');

    assert.equal(blocks.length, 3);
    assert.equal(blocks[0]!.kind, 'paragraph');
    assert.deepEqual(blocks[1], { kind: 'list', items: [[{ text: 'один' }], [{ text: 'два', bold: true }]] });
    assert.equal(blocks[2]!.kind, 'paragraph');
  });

  it('список сразу под строкой абзаца — отдельным блоком', () => {
    const blocks = parseMarkup('Что есть:\n• столы\n• робот');

    assert.deepEqual(
      blocks.map((block) => block.kind),
      ['paragraph', 'list'],
    );
  });

  it('пустой пункт пропадает, перенос внутри абзаца сохраняется', () => {
    assert.deepEqual(parseMarkup('- \n- есть'), [{ kind: 'list', items: [[{ text: 'есть' }]] }]);
    assert.deepEqual(parseMarkup('раз\nдва'), [{ kind: 'paragraph', spans: [{ text: 'раз\nдва' }] }]);
  });
});

describe('plainText', () => {
  it('без пометок, пункты — с точкой', () => {
    assert.equal(plainText('**Акция!** *до* пятницы\n\n- стол\n- робот'), 'Акция! до пятницы\n\n• стол\n• робот');
  });
});
