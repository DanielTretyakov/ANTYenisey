import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { boardBlocks, CLOSED_TITLE, RENT_TITLE, type BoardNames, type BoardSlot } from './public-board.ts';

const names: BoardNames = {
  trainingTypes: new Map([['tt', 'Общая групповая']]),
  tournaments: new Map([['cup', 'Клуб 100']]),
  tournamentTypes: new Map([['ct', 'Клуб 200']]),
  coaches: new Map([['coach', 'Тренеров И.']]),
};

const slot = (overrides: Partial<BoardSlot>): BoardSlot => ({
  tableId: 't1',
  startMinute: 600,
  endMinute: 660,
  purpose: 'OTHER',
  coachId: null,
  trainingTypeId: null,
  trainingSessionId: null,
  tournamentId: null,
  tournamentTypeId: null,
  ...overrides,
});

describe('boardBlocks', () => {
  it('аренда — без имени и цены, просто «Стол арендован»', () => {
    const [block] = boardBlocks([], [{ tableId: 't1', startMinute: 600, endMinute: 690, sparring: false }], names);
    assert.deepEqual(block, { startMinute: 600, endMinute: 690, kind: 'RENT', title: RENT_TITLE, subtitle: null, event: null });
  });

  it('занятие дня — тип, тренер и ссылка на запись; соседние окна слиты', () => {
    const training = { purpose: 'TRAINING' as const, coachId: 'coach', trainingTypeId: 'tt', trainingSessionId: 's1' };
    const blocks = boardBlocks(
      [slot({ ...training, startMinute: 1080, endMinute: 1110 }), slot({ ...training, startMinute: 1110, endMinute: 1170 })],
      [],
      names,
    );

    assert.equal(blocks.length, 1);
    assert.deepEqual(blocks[0], {
      startMinute: 1080,
      endMinute: 1170,
      kind: 'TRAINING',
      title: 'Общая групповая',
      subtitle: 'Тренер: Тренеров И.',
      event: { kind: 'TRAINING', id: 's1' },
    });
  });

  it('окно шаблона без занятия — тип есть, записи нет', () => {
    const [block] = boardBlocks([slot({ purpose: 'TRAINING', trainingTypeId: 'tt' })], [], names);
    assert.equal(block?.title, 'Общая групповая');
    assert.equal(block?.event, null);
  });

  it('турнир дня — по проведению, шаблона — по типу', () => {
    const [day] = boardBlocks([slot({ purpose: 'TOURNAMENT', tournamentId: 'cup' })], [], names);
    assert.deepEqual([day?.title, day?.event], ['Клуб 100', { kind: 'TOURNAMENT', id: 'cup' }]);

    const [template] = boardBlocks([slot({ purpose: 'TOURNAMENT', tournamentTypeId: 'ct' })], [], names);
    assert.deepEqual([template?.title, template?.event], ['Клуб 200', null]);
  });

  it('аренда мимо сайта, робот и прочее — «Стол занят», без причины', () => {
    for (const purpose of ['RENT', 'ROBOT', 'OTHER'] as const) {
      const [block] = boardBlocks([slot({ purpose })], [], names);
      assert.deepEqual([block?.kind, block?.title], ['CLOSED', CLOSED_TITLE]);
    }
  });

  it('бронь поверх окна — бронью, окно режется по ней', () => {
    const blocks = boardBlocks(
      [slot({ purpose: 'TRAINING', trainingTypeId: 'tt', startMinute: 600, endMinute: 780 })],
      [{ tableId: 't1', startMinute: 660, endMinute: 720, sparring: true }],
      names,
    );

    assert.deepEqual(
      blocks.map((block) => [block.startMinute, block.endMinute, block.kind]),
      [
        [600, 660, 'TRAINING'],
        [660, 720, 'SPARRING'],
        [720, 780, 'TRAINING'],
      ],
    );
  });

  it('бронь другого стола окно не режет', () => {
    const blocks = boardBlocks([slot({})], [{ tableId: 't2', startMinute: 600, endMinute: 660, sparring: false }], names);
    const closed = blocks.find((block) => block.kind === 'CLOSED');
    assert.deepEqual([closed?.startMinute, closed?.endMinute], [600, 660]);
  });
});
