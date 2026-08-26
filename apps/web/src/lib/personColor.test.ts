import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { personColors } from './personColor.ts';

describe('personColors', () => {
  it('разным людям достаются разные цвета', () => {
    const colors = personColors(['a', 'b', 'c']);
    const cells = new Set(['a', 'b', 'c'].map((id) => colors.get(id)!.cell));

    assert.equal(cells.size, 3);
  });

  it('цвет не зависит от порядка, в котором пришёл список', () => {
    // Иначе расписание перекрашивалось бы от одного ответа сервера к другому,
    // и цвет перестал бы что-либо значить.
    const first = personColors(['c', 'a', 'b']);
    const second = personColors(['b', 'c', 'a']);

    for (const id of ['a', 'b', 'c']) {
      assert.equal(first.get(id)!.cell, second.get(id)!.cell);
    }
  });

  it('повторы в списке не сдвигают раздачу', () => {
    const withDuplicates = personColors(['a', 'a', 'b']);
    const clean = personColors(['a', 'b']);

    assert.equal(withDuplicates.get('b')!.cell, clean.get('b')!.cell);
  });

  it('на длинном списке палитра идёт по кругу, а не кончается', () => {
    const ids = Array.from({ length: 25 }, (_, index) => `p${String(index).padStart(2, '0')}`);
    const colors = personColors(ids);

    assert.equal(colors.size, 25);
    for (const id of ids) {
      assert.ok(colors.get(id)!.cell.length > 0);
    }
  });

  it('незнакомый человек цвета не получает', () => {
    assert.equal(personColors(['a']).get('b'), undefined);
  });
});
