import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClosureSlot } from '@yenisey/types';
import {
  cellKey,
  cellsToSlots,
  copyLane,
  countOnLane,
  GRID_START_MINUTE,
  markTouched,
  nowMinuteIn,
  sameCells,
  sameValue,
  shiftDate,
  slotLabel,
  slotMinute,
  slotsToCells,
  SLOTS_PER_DAY,
  splitByGrid,
  toClosureRuleDraft,
  toDayClosureDraft,
  weekdayOf,
  type CellValue,
  type Cells,
} from './closureGrid.ts';

const slot = (overrides: Partial<ClosureSlot> = {}): ClosureSlot => ({
  tableId: 't1',
  startMinute: 15 * 60,
  endMinute: 19 * 60,
  purpose: 'TRAINING',
  coachId: 'coach-1',
  clientId: null,
  trainingTypeId: 'type-1',
  trainingSessionId: null,
  tournamentId: null,
  tournamentTypeId: null,
  ...overrides,
});

/** Все окна на одной дорожке — как в расписании конкретной даты. */
const oneLane = () => 'day';

function cells(
  entries: [string, CellValue][],
): Cells {
  return new Map(entries);
}

describe('сетка начинается с шести утра', () => {
  it('первый слот — 06:00, последний — 23:30', () => {
    assert.equal(slotLabel(0), '06:00');
    assert.equal(slotMinute(0), GRID_START_MINUTE);
    assert.equal(slotLabel(SLOTS_PER_DAY - 1), '23:30');
  });

  it('в сутках 36 получасовых строк, а не 48', () => {
    // Ночь убрана из таблицы: зал в это время закрыт, и двенадцать пустых
    // строк только мешали искать нужный час.
    assert.equal(SLOTS_PER_DAY, 36);
  });
});

describe('splitByGrid', () => {
  it('дневное окно уходит в сетку целиком', () => {
    const { inGrid, night } = splitByGrid([slot()]);

    assert.equal(inGrid.length, 1);
    assert.equal(night.length, 0);
  });

  it('ночное окно в сетку не попадает и сохраняется отдельно', () => {
    // Иначе сохранение сетки тихо стирало бы всё, что заведено до шести утра.
    const { inGrid, night } = splitByGrid([slot({ startMinute: 60, endMinute: 300 })]);

    assert.equal(inGrid.length, 0);
    assert.equal(night.length, 1);
  });

  it('окно через шесть утра делится, и части стыкуются без наложения', () => {
    const { inGrid, night } = splitByGrid([slot({ startMinute: 300, endMinute: 480 })]);

    assert.equal(night[0]?.endMinute, GRID_START_MINUTE);
    assert.equal(inGrid[0]?.startMinute, GRID_START_MINUTE);
    assert.equal(inGrid[0]?.endMinute, 480);
  });

  it('окно, кончающееся ровно в шесть, целиком ночное', () => {
    const { inGrid, night } = splitByGrid([slot({ startMinute: 240, endMinute: GRID_START_MINUTE })]);

    assert.equal(inGrid.length, 0);
    assert.equal(night.length, 1);
  });
});

describe('slotsToCells', () => {
  it('окно разворачивается в клетки по получасу', () => {
    const result = slotsToCells([slot()], oneLane);

    // 15:00–19:00 — это восемь получасовых клеток.
    assert.equal(result.size, 8);
    assert.equal(result.get(cellKey('day', 't1', 18))?.purpose, 'TRAINING');
  });

  it('клетка после конца окна не закрашивается', () => {
    // Окно кончается в 19:00, значит 19:00–19:30 уже свободно.
    assert.equal(slotsToCells([slot()], oneLane).has(cellKey('day', 't1', 26)), false);
  });

  it('назначение и тренер доезжают до клетки', () => {
    const value = slotsToCells(
      [slot({ purpose: 'RENT', coachId: null, clientId: null, trainingTypeId: null })],
      oneLane,
    ).get(cellKey('day', 't1', 18));

    assert.equal(value?.purpose, 'RENT');
    assert.equal(value?.coachId, null);
  });

  it('окно не по сетке округляется наружу — занятое время не теряется', () => {
    const result = slotsToCells(
      [slot({ startMinute: 15 * 60 + 10, endMinute: 15 * 60 + 50 })],
      oneLane,
    );

    assert.equal(result.size, 2);
  });

  it('тип турнира доезжает до клетки — им подписано окно в шаблоне', () => {
    // В шаблоне недели турнир хранится именно типом, и без переноса подпись
    // окна теряла бы название сразу после сохранения.
    const value = slotsToCells(
      [slot({ purpose: 'TOURNAMENT', coachId: null, trainingTypeId: null, tournamentTypeId: 'cup' })],
      oneLane,
    ).get(cellKey('day', 't1', 18));

    assert.equal(value?.tournamentTypeId, 'cup');
  });

  it('дорожка берётся из самого окна — так шаблон раскладывается по дням недели', () => {
    const byWeekday = (item: ClosureSlot) => String((item as { weekday?: number }).weekday ?? 1);
    const result = slotsToCells(
      [{ ...slot(), weekday: 3 } as ClosureSlot & { weekday: number }],
      byWeekday,
    );

    assert.equal(result.has(cellKey('3', 't1', 18)), true);
  });
});

describe('cellsToSlots', () => {
  it('соседние клетки одного назначения склеиваются в одно окно', () => {
    const result = cellsToSlots(slotsToCells([slot()], oneLane), ['day'], ['t1']);

    assert.equal(result.length, 1);
    assert.equal(result[0]?.startMinute, 900);
    assert.equal(result[0]?.endMinute, 1140);
    assert.equal(result[0]?.purpose, 'TRAINING');
  });

  it('смена тренера разрывает окно надвое', () => {
    // Тренировка Иванова встык с тренировкой Петрова — это два занятия, и
    // слить их значило бы приписать часы одному из них.
    const result = cellsToSlots(
      cells([
        [cellKey('day', 't1', 18), { purpose: 'TRAINING', coachId: 'a', clientId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
        [cellKey('day', 't1', 19), { purpose: 'TRAINING', coachId: 'b', clientId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
      ]),
      ['day'],
      ['t1'],
    );

    assert.equal(result.length, 2);
    assert.equal(result[0]?.coachId, 'a');
    assert.equal(result[1]?.coachId, 'b');
  });

  it('смена назначения тоже разрывает окно', () => {
    const result = cellsToSlots(
      cells([
        [cellKey('day', 't1', 18), { purpose: 'RENT', coachId: null, clientId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
        [cellKey('day', 't1', 19), { purpose: 'ROBOT', coachId: null, clientId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
      ]),
      ['day'],
      ['t1'],
    );

    assert.equal(result.length, 2);
  });

  it('разрыв в середине даёт два окна, а не одно', () => {
    const result = cellsToSlots(
      cells([
        [cellKey('day', 't1', 10), { purpose: 'RENT', coachId: null, clientId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
        [cellKey('day', 't1', 11), { purpose: 'RENT', coachId: null, clientId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
        // 12-я клетка пропущена — стол свободен
        [cellKey('day', 't1', 13), { purpose: 'RENT', coachId: null, clientId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
      ]),
      ['day'],
      ['t1'],
    );

    assert.equal(result.length, 2);
  });

  it('окно, упирающееся в полночь, закрывается на 1440', () => {
    const result = cellsToSlots(
      cells([[cellKey('day', 't1', SLOTS_PER_DAY - 1), { purpose: 'RENT', coachId: null, clientId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }]]),
      ['day'],
      ['t1'],
    );

    assert.equal(result[0]?.endMinute, 1440);
  });

  it('столы и дорожки не смешиваются между собой', () => {
    const result = cellsToSlots(
      cells([
        [cellKey('1', 't1', 18), { purpose: 'RENT', coachId: null, clientId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
        [cellKey('1', 't2', 18), { purpose: 'RENT', coachId: null, clientId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
        [cellKey('2', 't1', 18), { purpose: 'RENT', coachId: null, clientId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
      ]),
      ['1', '2'],
      ['t1', 't2'],
    );

    assert.equal(result.length, 3);
  });

  it('разбор и сборка возвращают исходное расписание', () => {
    const original = [
      slot({ startMinute: 600, endMinute: 720, purpose: 'RENT', coachId: null }),
      slot({ tableId: 't2', startMinute: 780, endMinute: 900 }),
    ];

    const rebuilt = cellsToSlots(slotsToCells(original, oneLane), ['day'], ['t1', 't2']);

    assert.equal(rebuilt.length, 2);
    for (const source of original) {
      assert.ok(
        rebuilt.some(
          (item) =>
            item.tableId === source.tableId &&
            item.startMinute === source.startMinute &&
            item.endMinute === source.endMinute &&
            item.purpose === source.purpose &&
            item.coachId === source.coachId,
        ),
        `окно ${source.tableId} ${source.startMinute} потерялось`,
      );
    }
  });

  it('пустая сетка даёт пустое расписание', () => {
    assert.deepEqual(cellsToSlots(new Map(), ['day'], ['t1']), []);
  });
});

describe('copyLane', () => {
  it('переносит занятое время на другую дорожку', () => {
    const source = cells([[cellKey('1', 't1', 18), { purpose: 'RENT', coachId: null, clientId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }]]);
    const next = copyLane(source, '1', ['2'], ['t1']);

    assert.equal(next.get(cellKey('2', 't1', 18))?.purpose, 'RENT');
    assert.equal(next.has(cellKey('1', 't1', 18)), true);
  });

  it('заменяет дорожку-получатель целиком, а не дополняет её', () => {
    // Иначе «скопировать понедельник на вторник» оставляло бы во вторнике
    // старые окна, и результат не совпадал бы с образцом.
    const source = cells([
      [cellKey('1', 't1', 18), { purpose: 'RENT', coachId: null, clientId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
      [cellKey('2', 't1', 10), { purpose: 'RENT', coachId: null, clientId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
    ]);
    const next = copyLane(source, '1', ['2'], ['t1']);

    assert.equal(next.has(cellKey('2', 't1', 18)), true);
    assert.equal(next.has(cellKey('2', 't1', 10)), false);
  });

  it('дорожка-образец не трогается, даже если она в списке получателей', () => {
    const source = cells([[cellKey('1', 't1', 18), { purpose: 'RENT', coachId: null, clientId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }]]);
    const next = copyLane(source, '1', ['1', '2'], ['t1']);

    assert.equal(next.has(cellKey('1', 't1', 18)), true);
  });
});

describe('countOnLane и sameCells', () => {
  it('счётчик считает клетки только своей дорожки', () => {
    const source = cells([
      [cellKey('1', 't1', 18), { purpose: 'RENT', coachId: null, clientId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
      [cellKey('1', 't2', 18), { purpose: 'RENT', coachId: null, clientId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
      [cellKey('2', 't1', 18), { purpose: 'RENT', coachId: null, clientId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
    ]);

    assert.equal(countOnLane(source, '1'), 2);
    assert.equal(countOnLane(source, '3'), 0);
  });

  it('смена тренера в клетке считается изменением', () => {
    // Иначе кнопка «Сохранить» оставалась бы погашенной после правки, которую
    // человек только что сделал.
    const a = cells([[cellKey('1', 't1', 18), { purpose: 'TRAINING', coachId: 'a', clientId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }]]);
    const b = cells([[cellKey('1', 't1', 18), { purpose: 'TRAINING', coachId: 'b', clientId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }]]);

    assert.equal(sameCells(a, a), true);
    assert.equal(sameCells(a, b), false);
  });
});

/** Клетка со всеми полями — база для сравнений. */
const value = (over: Partial<CellValue> = {}): CellValue => ({
  purpose: 'TRAINING',
  coachId: 'coach-1',
  clientId: null,
  trainingTypeId: 'type-1',
  trainingSessionId: null,
  tournamentId: null,
  tournamentTypeId: null,
  ...over,
});

describe('sameValue', () => {
  it('пустая клетка совпадает только с пустой', () => {
    assert.equal(sameValue(undefined, undefined), true);
    assert.equal(sameValue(value(), undefined), false);
    assert.equal(sameValue(undefined, value()), false);
  });

  /**
   * Ровно тот случай, который раньше проваливался: `sameCells` не смотрел на
   * занятие, а склейка окон смотрела. Подмена занятия не поднимала «есть
   * несохранённые правки», зато резала окно надвое при сохранении.
   */
  it('разное занятие делает клетки разными', () => {
    assert.equal(
      sameValue(value({ trainingSessionId: 's1' }), value({ trainingSessionId: 's2' })),
      false,
    );
  });

  it('различается любое из семи полей', () => {
    const fields: Partial<CellValue>[] = [
      { purpose: 'RENT' },
      { coachId: 'coach-2' },
      { clientId: 'client-1' },
      { trainingTypeId: 'type-2' },
      { trainingSessionId: 'session-1' },
      { tournamentId: 'cup-1' },
      { tournamentTypeId: 'cup-type-1' },
    ];

    for (const field of fields) {
      assert.equal(sameValue(value(), value(field)), false, JSON.stringify(field));
    }
  });
});

describe('sameCells видит подмену занятия', () => {
  it('клетки, отличающиеся только занятием, считаются разными', () => {
    const key = cellKey('day', 't1', 0);

    assert.equal(
      sameCells(cells([[key, value()]]), cells([[key, value({ trainingSessionId: 's1' })]])),
      false,
    );
  });
});

describe('toDayClosureDraft', () => {
  /**
   * Главное, ради чего функция заведена: у шаблонного окна есть `weekday`, и
   * снятие полей через `...rest` протаскивало его в тело запроса дня. Сервер с
   * `forbidNonWhitelisted` такое тело отклонял, и сохранение дня падало на
   * любом зале, где в шаблоне есть окно до шести утра.
   */
  it('лишние поля не проезжают в тело запроса', () => {
    const draft = toDayClosureDraft({ ...slot(), weekday: 3, id: 'rule-1' } as ClosureSlot);

    assert.equal('weekday' in draft, false);
    assert.equal('id' in draft, false);
    assert.equal(Object.keys(draft).length, 10);
  });

  it('все поля окна сохраняются', () => {
    const source = slot({ tournamentTypeId: 'cup-1' });

    assert.deepEqual(toDayClosureDraft(source), source);
  });

  it('шаблонное окно получает день недели', () => {
    assert.equal(toClosureRuleDraft(slot(), 5).weekday, 5);
  });
});

describe('weekdayOf', () => {
  it('воскресенье — семь, а не ноль', () => {
    // 15 марта 2026 года — воскресенье.
    assert.equal(weekdayOf('2026-03-15'), 7);
  });

  it('понедельник — единица', () => {
    assert.equal(weekdayOf('2026-03-16'), 1);
  });
});

describe('shiftDate', () => {
  it('сдвигает на день вперёд и назад', () => {
    assert.equal(shiftDate('2026-03-12', 1), '2026-03-13');
    assert.equal(shiftDate('2026-03-12', -1), '2026-03-11');
  });

  it('переходит через границу месяца и года', () => {
    assert.equal(shiftDate('2026-02-28', 1), '2026-03-01');
    assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  });

  it('знает про високосный год', () => {
    assert.equal(shiftDate('2028-02-28', 1), '2028-02-29');
  });
});

describe('nowMinuteIn', () => {
  it('считает по поясу зала, а не браузера', () => {
    // 12:00 UTC — это 19:00 в Красноярске (UTC+7) и 15:00 в Москве (UTC+3).
    const at = new Date('2026-03-12T12:00:00Z');

    assert.equal(nowMinuteIn('Asia/Krasnoyarsk', at), 19 * 60);
    assert.equal(nowMinuteIn('Europe/Moscow', at), 15 * 60);
  });

  it('полночь — ноль, а не 1440', () => {
    assert.equal(nowMinuteIn('UTC', new Date('2026-03-12T00:00:00Z')), 0);
  });
});

describe('markTouched', () => {
  /** Окно 06:00–07:00 на первом столе: клетки 0 и 1. */
  const window = slot({ startMinute: GRID_START_MINUTE, endMinute: GRID_START_MINUTE + 60 });
  const half = (tableId: string) =>
    slot({ tableId, startMinute: GRID_START_MINUTE, endMinute: GRID_START_MINUTE + 30 });

  it('нетронутое окно не метится', () => {
    const same = cells([
      [cellKey('day', 't1', 0), value()],
      [cellKey('day', 't1', 1), value()],
    ]);

    assert.equal(markTouched([window], same, same, oneLane)[0]!.touched, false);
  });

  /**
   * Ровно то, ради чего функция нужна: день, отвязанный от шаблона, полон окон
   * с типом тренировки и без занятия. Заводить по ним занятия нельзя —
   * администратор их не размечал, он их просто увидел.
   */
  it('окно из шаблона остаётся нетронутым при правке соседнего стола', () => {
    const before = cells([[cellKey('day', 't1', 0), value()]]);
    const after = cells([
      [cellKey('day', 't1', 0), value()],
      [cellKey('day', 't2', 0), value()],
    ]);

    const marked = markTouched([half('t1'), half('t2')], after, before, oneLane);

    assert.equal(marked[0]!.touched, false);
    assert.equal(marked[1]!.touched, true);
  });

  it('правка одной клетки метит всё окно', () => {
    const before = cells([
      [cellKey('day', 't1', 0), value()],
      [cellKey('day', 't1', 1), value()],
    ]);
    const after = cells([
      [cellKey('day', 't1', 0), value()],
      [cellKey('day', 't1', 1), value({ coachId: 'coach-2' })],
    ]);

    assert.equal(markTouched([window], after, before, oneLane)[0]!.touched, true);
  });
});
