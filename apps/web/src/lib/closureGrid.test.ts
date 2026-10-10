import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClosureSlot } from '@yenisey/types';
import {
  cellBlocks,
  cellKey,
  cellsToSlots,
  copyLane,
  countOnLane,
  GRID_START_MINUTE,
  markForOpening,
  matchesBrush,
  NEW_SESSION,
  planDayEvents,
  seatAfterPick,
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
      [slot({ purpose: 'RENT', coachId: null, trainingTypeId: null })],
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
        [cellKey('day', 't1', 18), { purpose: 'TRAINING', coachId: 'a', trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
        [cellKey('day', 't1', 19), { purpose: 'TRAINING', coachId: 'b', trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
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
        [cellKey('day', 't1', 18), { purpose: 'RENT', coachId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
        [cellKey('day', 't1', 19), { purpose: 'ROBOT', coachId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
      ]),
      ['day'],
      ['t1'],
    );

    assert.equal(result.length, 2);
  });

  it('разрыв в середине даёт два окна, а не одно', () => {
    const result = cellsToSlots(
      cells([
        [cellKey('day', 't1', 10), { purpose: 'RENT', coachId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
        [cellKey('day', 't1', 11), { purpose: 'RENT', coachId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
        // 12-я клетка пропущена — стол свободен
        [cellKey('day', 't1', 13), { purpose: 'RENT', coachId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
      ]),
      ['day'],
      ['t1'],
    );

    assert.equal(result.length, 2);
  });

  it('окно, упирающееся в полночь, закрывается на 1440', () => {
    const result = cellsToSlots(
      cells([[cellKey('day', 't1', SLOTS_PER_DAY - 1), { purpose: 'RENT', coachId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }]]),
      ['day'],
      ['t1'],
    );

    assert.equal(result[0]?.endMinute, 1440);
  });

  it('столы и дорожки не смешиваются между собой', () => {
    const result = cellsToSlots(
      cells([
        [cellKey('1', 't1', 18), { purpose: 'RENT', coachId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
        [cellKey('1', 't2', 18), { purpose: 'RENT', coachId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
        [cellKey('2', 't1', 18), { purpose: 'RENT', coachId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
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
    const source = cells([[cellKey('1', 't1', 18), { purpose: 'RENT', coachId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }]]);
    const next = copyLane(source, '1', ['2'], ['t1']);

    assert.equal(next.get(cellKey('2', 't1', 18))?.purpose, 'RENT');
    assert.equal(next.has(cellKey('1', 't1', 18)), true);
  });

  it('заменяет дорожку-получатель целиком, а не дополняет её', () => {
    // Иначе «скопировать понедельник на вторник» оставляло бы во вторнике
    // старые окна, и результат не совпадал бы с образцом.
    const source = cells([
      [cellKey('1', 't1', 18), { purpose: 'RENT', coachId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
      [cellKey('2', 't1', 10), { purpose: 'RENT', coachId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
    ]);
    const next = copyLane(source, '1', ['2'], ['t1']);

    assert.equal(next.has(cellKey('2', 't1', 18)), true);
    assert.equal(next.has(cellKey('2', 't1', 10)), false);
  });

  it('дорожка-образец не трогается, даже если она в списке получателей', () => {
    const source = cells([[cellKey('1', 't1', 18), { purpose: 'RENT', coachId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }]]);
    const next = copyLane(source, '1', ['1', '2'], ['t1']);

    assert.equal(next.has(cellKey('1', 't1', 18)), true);
  });
});

describe('countOnLane и sameCells', () => {
  it('счётчик считает клетки только своей дорожки', () => {
    const source = cells([
      [cellKey('1', 't1', 18), { purpose: 'RENT', coachId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
      [cellKey('1', 't2', 18), { purpose: 'RENT', coachId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
      [cellKey('2', 't1', 18), { purpose: 'RENT', coachId: null, trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }],
    ]);

    assert.equal(countOnLane(source, '1'), 2);
    assert.equal(countOnLane(source, '3'), 0);
  });

  it('смена тренера в клетке считается изменением', () => {
    // Иначе кнопка «Сохранить» оставалась бы погашенной после правки, которую
    // человек только что сделал.
    const a = cells([[cellKey('1', 't1', 18), { purpose: 'TRAINING', coachId: 'a', trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }]]);
    const b = cells([[cellKey('1', 't1', 18), { purpose: 'TRAINING', coachId: 'b', trainingTypeId: null, trainingSessionId: null, tournamentId: null, tournamentTypeId: null }]]);

    assert.equal(sameCells(a, a), true);
    assert.equal(sameCells(a, b), false);
  });
});

/** Клетка со всеми полями — база для сравнений. */
const value = (over: Partial<CellValue> = {}): CellValue => ({
  purpose: 'TRAINING',
  coachId: 'coach-1',
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

  it('различается любое из шести полей', () => {
    const fields: Partial<CellValue>[] = [
      { purpose: 'RENT' },
      { coachId: 'coach-2' },
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
    assert.equal(Object.keys(draft).length, 9);
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

describe('matchesBrush', () => {
  const brush = value({ trainingSessionId: null });

  it('совпало всё, что задаёт кисть, — стирает', () => {
    assert.equal(matchesBrush(value(), brush), true);
  });

  it('другой тип занятия того же тренера — перекраска, а не стирание', () => {
    assert.equal(matchesBrush(value({ trainingTypeId: 'type-2' }), brush), false);
  });

  it('другой тип турнира — перекраска', () => {
    const cup = value({ purpose: 'TOURNAMENT', coachId: null, trainingTypeId: null, tournamentTypeId: 'cup-1' });

    assert.equal(matchesBrush(cup, { ...cup, tournamentTypeId: 'cup-2' }), false);
    // Сохранённое окно дня несёт и проведение, и его тип — для кисти это тот же турнир.
    assert.equal(matchesBrush({ ...cup, tournamentId: 'x' }, cup), true);
  });

  it('кисть дня перекрашивает окно тренировки без занятия — так открывают запись', () => {
    const dayBrush = value({ trainingSessionId: NEW_SESSION });

    assert.equal(matchesBrush(value({ trainingSessionId: null }), dayBrush), false);
    assert.equal(matchesBrush(value({ trainingSessionId: 's1' }), dayBrush), true);
    assert.equal(matchesBrush(value({ trainingSessionId: NEW_SESSION }), dayBrush), true);
  });
});

describe('planDayEvents', () => {
  const at = (hour: number) => hour * 60;
  const training = (overrides: Partial<ClosureSlot> = {}) =>
    slot({ trainingSessionId: NEW_SESSION, startMinute: at(18), endMinute: at(19), ...overrides });
  const cup = (overrides: Partial<ClosureSlot> = {}) =>
    slot({
      purpose: 'TOURNAMENT',
      coachId: null,
      trainingTypeId: null,
      tournamentTypeId: 'cup-1',
      startMinute: at(10),
      endMinute: at(12),
      ...overrides,
    });

  it('группа на четырёх столах — одно занятие', () => {
    const plan = planDayEvents(['t1', 't2', 't3', 't4'].map((tableId) => training({ tableId })), []);

    assert.deepEqual(plan.sessions, [
      { trainingTypeId: 'type-1', coachId: 'coach-1', startMinute: at(18), endMinute: at(19) },
    ]);
    assert.ok(plan.slots.every((item) => JSON.stringify(item.session) === JSON.stringify({ create: 0 })));
  });

  it('утренняя и вечерняя группа одного тренера — два занятия, а не одно на весь день', () => {
    const plan = planDayEvents(
      [training({ startMinute: at(10), endMinute: at(11) }), training({ startMinute: at(18), endMinute: at(19) })],
      [],
    );

    assert.equal(plan.sessions.length, 2);
    assert.deepEqual(plan.sessions.map((session) => session.startMinute), [at(10), at(18)]);
  });

  it('встык во времени — одна группа, даже на разных столах', () => {
    const plan = planDayEvents(
      [training({ tableId: 't1' }), training({ tableId: 't2', startMinute: at(19), endMinute: at(20) })],
      [],
    );

    assert.deepEqual(plan.sessions.map(({ startMinute, endMinute }) => [startMinute, endMinute]), [
      [at(18), at(20)],
    ]);
  });

  it('разные тренеры — разные занятия', () => {
    const plan = planDayEvents([training(), training({ tableId: 't2', coachId: 'coach-2' })], []);

    assert.equal(plan.sessions.length, 2);
  });

  it('продление заведённой группы идёт к ней, а не заводит вторую', () => {
    const existing = training({ trainingSessionId: 's1' });
    const extension = training({ startMinute: at(19), endMinute: at(19) + 30 });
    const plan = planDayEvents([existing, extension], []);

    assert.equal(plan.sessions.length, 0);
    assert.deepEqual(plan.slots[1]!.session, { id: 's1' });
  });

  it('группа, перенесённая на другие столы в то же время, остаётся своим занятием', () => {
    const before = training({ tableId: 't1', trainingSessionId: 's1' });
    const moved = training({ tableId: 't5' });
    const plan = planDayEvents([moved], [before]);

    assert.deepEqual(plan.slots[0]!.session, { id: 's1' });
  });

  it('окна из шаблона без метки занятия не заводят', () => {
    const plan = planDayEvents([training({ trainingSessionId: null })], []);

    assert.equal(plan.sessions.length, 0);
    assert.equal(plan.slots[0]!.session, null);
  });

  it('метка без тренера остаётся без занятия — откажет сервер с причиной', () => {
    const plan = planDayEvents([training({ coachId: null })], []);

    assert.equal(plan.sessions.length, 0);
    assert.equal(plan.slots[0]!.session, null);
  });

  it('турнир — один на тип, границы — по всем его окнам', () => {
    const plan = planDayEvents(
      [cup({ tableId: 't1' }), cup({ tableId: 't2', startMinute: at(11), endMinute: at(14) })],
      [],
    );

    assert.deepEqual(plan.tournaments, [{ tournamentTypeId: 'cup-1', startMinute: at(10), endMinute: at(14) }]);
    assert.ok(plan.slots.every((item) => JSON.stringify(item.tournament) === JSON.stringify({ create: 0 })));
  });

  it('дорисованный турнир того же типа идёт к уже заведённому, а не заводит второй', () => {
    const plan = planDayEvents([cup({ tournamentId: 'x' }), cup({ tableId: 't2', tournamentId: null })], []);

    assert.equal(plan.tournaments.length, 0);
    assert.deepEqual(plan.slots[1]!.tournament, { id: 'x' });
  });

  it('стёртый и нарисованный заново турнир остаётся тем же проведением', () => {
    const plan = planDayEvents([cup({ tableId: 't3' })], [cup({ tournamentId: 'x' })]);

    assert.deepEqual(plan.slots[0]!.tournament, { id: 'x' });
  });

  it('у аренды мероприятий нет', () => {
    const plan = planDayEvents([slot({ purpose: 'RENT', coachId: null, trainingTypeId: null })], []);

    assert.deepEqual(plan.slots[0], { slot: plan.slots[0]!.slot, tournament: null, session: null });
  });
});

describe('seatAfterPick', () => {
  const free = () => false;
  const pick = (from: number, to = from + 1, tableId = 't1') => ({ tableId, from, to });

  it('щелчок — минимальная бронь от клетки', () => {
    assert.deepEqual(seatAfterPick(null, pick(4), 2, free), pick(4, 6));
  });

  it('щелчок ниже на том же столе — конец отрезка там', () => {
    assert.deepEqual(seatAfterPick(pick(4, 6), pick(8), 2, free), pick(4, 9));
    // И укоротить можно тем же щелчком.
    assert.deepEqual(seatAfterPick(pick(4, 9), pick(5), 2, free), pick(4, 6));
  });

  it('щелчок по началу снимает выбор', () => {
    assert.equal(seatAfterPick(pick(4, 6), pick(4), 2, free), null);
  });

  it('щелчок выше начала или на другом столе — новый выбор', () => {
    assert.deepEqual(seatAfterPick(pick(4, 6), pick(2), 2, free), pick(2, 4));
    assert.deepEqual(seatAfterPick(pick(4, 6), pick(8, 9, 't2'), 2, free), pick(8, 10, 't2'));
  });

  it('протяжка — ровно протянутое', () => {
    assert.deepEqual(seatAfterPick(pick(1, 2), pick(10, 15), 2, free), pick(10, 15));
  });

  it('обрезается на чужой брони и не начинается на ней', () => {
    const busy = (_table: string, slot: number) => slot === 7;

    assert.deepEqual(seatAfterPick(null, pick(4, 10), 2, busy), pick(4, 7));
    assert.equal(seatAfterPick(null, pick(7), 2, busy), null);
  });

  it('не выходит за полночь', () => {
    assert.deepEqual(seatAfterPick(null, pick(SLOTS_PER_DAY - 1), 2, free), pick(SLOTS_PER_DAY - 1, SLOTS_PER_DAY));
  });
});

describe('cellBlocks', () => {
  const lane = 'day';
  const fill = (entries: [string, number, number, CellValue][]): Cells => {
    const result: Cells = new Map();

    for (const [tableId, from, to, cell] of entries) {
      for (let at = from; at < to; at += 1) result.set(cellKey(lane, tableId, at), cell);
    }

    return result;
  };
  const group = value({ trainingSessionId: 's1' });
  const shape = (blocks: ReturnType<typeof cellBlocks>) =>
    blocks.map(({ firstTable, lastTable, from, to }) => [firstTable, lastTable, from, to]);

  it('одно занятие на столах 1 и 2 в одно время — один блок', () => {
    const blocks = cellBlocks(fill([['t1', 24, 26, group], ['t2', 24, 26, group]]), lane, ['t1', 't2', 't3']);

    assert.deepEqual(shape(blocks), [[0, 1, 24, 26]]);
  });

  it('разное время на соседних столах — разные блоки', () => {
    const blocks = cellBlocks(fill([['t1', 24, 26, group], ['t2', 24, 27, group]]), lane, ['t1', 't2']);

    assert.deepEqual(shape(blocks), [[0, 0, 24, 26], [1, 1, 24, 27]]);
  });

  it('столы не подряд не склеиваются', () => {
    const blocks = cellBlocks(fill([['t1', 24, 26, group], ['t3', 24, 26, group]]), lane, ['t1', 't2', 't3']);

    assert.deepEqual(shape(blocks), [[0, 0, 24, 26], [2, 2, 24, 26]]);
  });

  it('разные занятия рядом — разные блоки', () => {
    const other = value({ trainingSessionId: 's2' });
    const blocks = cellBlocks(fill([['t1', 24, 26, group], ['t2', 24, 26, other]]), lane, ['t1', 't2']);

    assert.equal(blocks.length, 2);
  });

  it('окна шаблона склеиваются по виду, типу и тренеру', () => {
    const template = value({ trainingSessionId: null });
    const blocks = cellBlocks(
      fill([['t1', 20, 22, template], ['t2', 20, 22, template], ['t3', 20, 22, value({ coachId: 'coach-2' })]]),
      lane,
      ['t1', 't2', 't3'],
    );

    assert.deepEqual(shape(blocks), [[0, 1, 20, 22], [2, 2, 20, 22]]);
  });

  it('турнир склеивается по проведению', () => {
    const cup = value({ purpose: 'TOURNAMENT', coachId: null, trainingTypeId: null, tournamentId: 'x', tournamentTypeId: 'c' });
    const blocks = cellBlocks(fill([['t1', 8, 12, cup], ['t2', 8, 12, cup]]), lane, ['t1', 't2']);

    assert.deepEqual(shape(blocks), [[0, 1, 8, 12]]);
  });

  it('аренда и робот блоками не становятся', () => {
    const rent = value({ purpose: 'RENT', coachId: null, trainingTypeId: null });

    assert.equal(cellBlocks(fill([['t1', 8, 12, rent], ['t2', 8, 12, rent]]), lane, ['t1', 't2']).length, 0);
  });

  it('несохранённое продление — отдельным блоком до сохранения', () => {
    const extension = value({ trainingSessionId: NEW_SESSION });
    const blocks = cellBlocks(fill([['t1', 24, 26, group], ['t1', 26, 27, extension]]), lane, ['t1']);

    assert.deepEqual(shape(blocks), [[0, 0, 24, 26], [0, 0, 26, 27]]);
  });
});

describe('markForOpening', () => {
  const usable = { trainingTypeIds: new Set(['type-1']), coachIds: new Set(['coach-1']) };

  it('метит тренировки без записи — и только их', () => {
    const marked = markForOpening(
      [
        slot({ trainingSessionId: null }),
        slot({ trainingSessionId: 's1' }),
        slot({ purpose: 'RENT', coachId: null, trainingTypeId: null }),
      ],
      usable,
    );

    assert.deepEqual(
      marked.map((item) => item.trainingSessionId),
      [NEW_SESSION, 's1', null],
    );
  });

  it('снятый с продажи вид и ушедший тренер остаются без записи', () => {
    const marked = markForOpening(
      [slot({ trainingTypeId: 'type-old' }), slot({ coachId: 'coach-gone' })],
      usable,
    );

    assert.ok(marked.every((item) => item.trainingSessionId === null));
  });

  it('вместе с планом даёт одно занятие на группу', () => {
    const marked = markForOpening(['t1', 't2', 't3'].map((tableId) => slot({ tableId })), usable);

    assert.equal(planDayEvents(marked, []).sessions.length, 1);
  });
});
