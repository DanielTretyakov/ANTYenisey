import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClosureRule, ClosureSlot, DayClosure, Weekday } from '@yenisey/types';
import {
  attachedPersonId,
  closedBySlots,
  findOverlap,
  formatMinutes,
  localParts,
  localSegments,
  overlaps,
  ruleGroupKey,
  slotsForDate,
  slotViolations,
  templateViolations,
} from './closures.ts';

const KRSK = 'Asia/Krasnoyarsk';

/** Окно шаблона: «стол закрыт в такой-то день с такого-то часа». */
function rule(overrides: Partial<ClosureRule> = {}): ClosureRule {
  return {
    id: 'r1',
    tableId: 't1',
    weekday: 2,
    startMinute: 15 * 60,
    endMinute: 19 * 60,
    purpose: 'TRAINING',
    coachId: 'coach-1',
    clientId: null,
    trainingTypeId: 'type-1',
    tournamentId: null,
    ...overrides,
  };
}

function dayClosure(overrides: Partial<DayClosure> = {}): DayClosure {
  return {
    id: 'd1',
    tableId: 't1',
    startMinute: 10 * 60,
    endMinute: 11 * 60,
    purpose: 'RENT',
    coachId: null,
    clientId: null,
    trainingTypeId: null,
    tournamentId: null,
    ...overrides,
  };
}

describe('localParts', () => {
  it('переводит мгновение UTC во время клуба', () => {
    // 2026-03-10 — вторник. 08:00 UTC в Красноярске (UTC+7) — это 15:00.
    const parts = localParts(new Date('2026-03-10T08:00:00Z'), KRSK);

    assert.equal(parts.weekday, 2);
    assert.equal(parts.date, '2026-03-10');
    assert.equal(parts.minutes, 15 * 60);
  });

  it('день недели берётся местный, а не UTC', () => {
    // 22:00 UTC вторника — это уже 05:00 среды в Красноярске.
    const parts = localParts(new Date('2026-03-10T22:00:00Z'), KRSK);

    assert.equal(parts.weekday, 3);
    assert.equal(parts.date, '2026-03-11');
    assert.equal(parts.minutes, 5 * 60);
  });

  it('полночь — это ноль минут, а не 1440', () => {
    assert.equal(localParts(new Date('2026-03-10T17:00:00Z'), KRSK).minutes, 0);
  });

  it('воскресенье — седьмой день, а не нулевой', () => {
    assert.equal(localParts(new Date('2026-03-15T08:00:00Z'), KRSK).weekday, 7);
  });
});

describe('localSegments', () => {
  it('промежуток внутри одних суток — один отрезок', () => {
    const segments = localSegments(
      new Date('2026-03-10T08:00:00Z'),
      new Date('2026-03-10T09:00:00Z'),
      KRSK,
    );

    assert.deepEqual(segments, [{ weekday: 2, startMinute: 900, endMinute: 960 }]);
  });

  it('переход через местную полночь даёт два отрезка разных дней', () => {
    const segments = localSegments(
      new Date('2026-03-10T16:30:00Z'),
      new Date('2026-03-10T17:30:00Z'),
      KRSK,
    );

    assert.deepEqual(segments, [
      { weekday: 2, startMinute: 1410, endMinute: 1440 },
      { weekday: 3, startMinute: 0, endMinute: 30 },
    ]);
  });

  it('ровно до полуночи — один отрезок, пустого хвоста нет', () => {
    const segments = localSegments(
      new Date('2026-03-10T16:00:00Z'),
      new Date('2026-03-10T17:00:00Z'),
      KRSK,
    );

    assert.deepEqual(segments, [{ weekday: 2, startMinute: 1380, endMinute: 1440 }]);
  });
});

describe('overlaps', () => {
  it('стык пересечением не считается', () => {
    assert.equal(overlaps(900, 960, 960, 1020), false);
    assert.equal(overlaps(960, 1020, 900, 960), false);
  });

  it('частичное наложение и вложенность считаются', () => {
    assert.equal(overlaps(900, 960, 930, 990), true);
    assert.equal(overlaps(900, 990, 930, 960), true);
    assert.equal(overlaps(930, 960, 900, 990), true);
  });
});

describe('closedBySlots', () => {
  /** Расписание, одинаковое во все дни недели. */
  const always = (slots: ClosureSlot[]) => () => slots;

  it('бронь внутри занятого окна отклоняется', () => {
    assert.equal(
      closedBySlots(
        always([rule()]),
        't1',
        new Date('2026-03-10T09:00:00Z'), // 16:00
        new Date('2026-03-10T10:00:00Z'),
        KRSK,
      ),
      true,
    );
  });

  it('бронь встык с занятым окном разрешена', () => {
    // Окно занято до 19:00; бронь с 19:00 занимает уже свободное время.
    assert.equal(
      closedBySlots(
        always([rule()]),
        't1',
        new Date('2026-03-10T12:00:00Z'),
        new Date('2026-03-10T13:00:00Z'),
        KRSK,
      ),
      false,
    );
  });

  it('окно одного стола не закрывает соседний', () => {
    assert.equal(
      closedBySlots(
        always([rule()]),
        't2',
        new Date('2026-03-10T09:00:00Z'),
        new Date('2026-03-10T10:00:00Z'),
        KRSK,
      ),
      false,
    );
  });

  it('бронь через полночь сверяется с расписанием обоих суток', () => {
    // 23:30 понедельника — 00:30 вторника. Занято только у вторника.
    const slotsFor = (weekday: Weekday): ClosureSlot[] =>
      weekday === 2 ? [rule({ weekday: 2, startMinute: 0, endMinute: 60 })] : [];

    assert.equal(
      closedBySlots(
        slotsFor,
        't1',
        new Date('2026-03-09T16:30:00Z'),
        new Date('2026-03-09T17:30:00Z'),
        KRSK,
      ),
      true,
    );
  });

  it('часовой пояс клуба решает, в какие сутки попала бронь', () => {
    // Тот же мгновенный промежуток: в Москве это ещё вторник, в Красноярске —
    // уже среда, и расписание вторника его не касается.
    const from = new Date('2026-03-10T20:00:00Z');
    const to = new Date('2026-03-10T21:00:00Z');
    const slotsFor = (weekday: Weekday): ClosureSlot[] =>
      weekday === 2 ? [rule({ startMinute: 23 * 60, endMinute: 1440 })] : [];

    assert.equal(closedBySlots(slotsFor, 't1', from, to, 'Europe/Moscow'), true);
    assert.equal(closedBySlots(slotsFor, 't1', from, to, KRSK), false);
  });
});

describe('findOverlap', () => {
  it('на непересекающемся шаблоне возвращает null', () => {
    assert.equal(
      findOverlap(
        [
          rule({ weekday: 2, startMinute: 600, endMinute: 720 }),
          rule({ weekday: 2, startMinute: 720, endMinute: 840 }),
          rule({ weekday: 3, startMinute: 600, endMinute: 720 }),
          rule({ tableId: 't2', weekday: 2, startMinute: 600, endMinute: 720 }),
        ],
        ruleGroupKey,
      ),
      null,
    );
  });

  it('находит наложение в пределах одного стола и дня', () => {
    const found = findOverlap(
      [
        rule({ weekday: 2, startMinute: 600, endMinute: 780 }),
        rule({ weekday: 2, startMinute: 720, endMinute: 840 }),
      ],
      ruleGroupKey,
    );

    assert.equal(found?.[0].startMinute, 600);
    assert.equal(found?.[1].startMinute, 720);
  });

  it('в расписании дня дня недели нет — группировка только по столу', () => {
    const found = findOverlap([
      dayClosure({ startMinute: 600, endMinute: 780 }),
      dayClosure({ startMinute: 720, endMinute: 840 }),
    ]);

    assert.notEqual(found, null);
  });
});

describe('slotViolations', () => {
  it('тренировка с тренером замечаний не вызывает', () => {
    assert.deepEqual(slotViolations(rule()), []);
  });

  it('тренировка без тренера отклоняется', () => {
    const violations = slotViolations(rule({ coachId: null }));

    assert.equal(violations.length, 1);
    assert.match(violations[0]!, /назначьте тренера/);
  });

  it('у аренды тренера быть не должно', () => {
    // Не «необязателен», а запрещён: иначе туда сложат «просто кого-нибудь»,
    // и статистика тренера наберёт чужие часы.
    const violations = slotViolations(
      rule({ purpose: 'RENT', coachId: 'coach-1', trainingTypeId: null }),
    );

    assert.equal(violations.length, 1);
    assert.match(violations[0]!, /только для тренировки и спарринга/);
  });

  it('спарринг допускается и с тренером, и без него', () => {
    const sparring = { purpose: 'SPARRING', trainingTypeId: null } as const;

    assert.deepEqual(slotViolations(rule({ ...sparring, coachId: 'coach-1' })), []);
    assert.deepEqual(slotViolations(rule({ ...sparring, coachId: null })), []);
  });

  it('тренировка без типа отклоняется', () => {
    // От типа зависит цена, а «просто тренировка» в расписании не говорит
    // клиенту, на что он записывается.
    const violations = slotViolations(rule({ trainingTypeId: null }));

    assert.equal(violations.length, 1);
    assert.match(violations[0]!, /выберите тип/);
  });

  it('тип тренировки у аренды отклоняется', () => {
    assert.equal(
      slotViolations(rule({ purpose: 'RENT', coachId: null, trainingTypeId: 'type-1' })).length,
      1,
    );
  });

  it('турнир требует указания, какой именно', () => {
    const violations = slotViolations(
      rule({ purpose: 'TOURNAMENT', coachId: null, trainingTypeId: null }),
    );

    assert.equal(violations.length, 1);
    assert.match(violations[0]!, /какой именно турнир/);
  });

  it('турнир с указанием замечаний не вызывает', () => {
    assert.deepEqual(
      slotViolations(
        rule({
          purpose: 'TOURNAMENT',
          coachId: null,
          trainingTypeId: null,
          tournamentId: 'cup-1',
        }),
      ),
      [],
    );
  });

  it('в шаблоне недели турнира быть не может', () => {
    // У турнира конкретная дата, а «каждую субботу один и тот же турнир» — это
    // не турнир, а серия разных.
    const violations = templateViolations(
      rule({
        purpose: 'TOURNAMENT',
        coachId: null,
        trainingTypeId: null,
        tournamentId: 'cup-1',
      }),
    );

    assert.equal(violations.length, 1);
    assert.match(violations[0]!, /шаблон недели/);
  });

  it('аренда закрепляется за клиентом', () => {
    assert.deepEqual(
      slotViolations(
        rule({ purpose: 'RENT', coachId: null, clientId: 'client-1', trainingTypeId: null }),
      ),
      [],
    );
  });

  it('аренда без клиента тоже законна — стол занимают до того, как знают кто', () => {
    assert.deepEqual(
      slotViolations(rule({ purpose: 'RENT', coachId: null, trainingTypeId: null })),
      [],
    );
  });

  it('клиент у тренировки отклоняется', () => {
    // Участников на тренировке десяток, и один «закреплённый» ввёл бы в
    // заблуждение.
    const violations = slotViolations(rule({ clientId: 'client-1' }));

    assert.equal(violations.length, 1);
    assert.match(violations[0]!, /только за арендой и роботом/);
  });

  it('незаполненные поля приходят как undefined и замечаний не вызывают', () => {
    // Клиент, не присланный вовсе, — это undefined, а не null. Без приведения
    // «клиент только у аренды» срабатывало бы на каждой тренировке.
    const partial = { ...rule() } as Partial<ClosureRule> & ClosureRule;
    delete (partial as { clientId?: unknown }).clientId;

    assert.deepEqual(slotViolations(partial), []);
  });

  it('вывернутое и вышедшее за сутки окно отклоняются', () => {
    assert.equal(slotViolations(rule({ startMinute: 600, endMinute: 600 })).length, 1);
    assert.equal(slotViolations(rule({ startMinute: 600, endMinute: 1441 })).length, 1);
  });
});

describe('attachedPersonId', () => {
  it('у тренировки и спарринга это тренер', () => {
    assert.equal(attachedPersonId(rule()), 'coach-1');
    assert.equal(attachedPersonId(rule({ purpose: 'SPARRING' })), 'coach-1');
  });

  it('у аренды и робота — клиент', () => {
    assert.equal(
      attachedPersonId(rule({ purpose: 'RENT', coachId: null, clientId: 'client-1' })),
      'client-1',
    );
    assert.equal(
      attachedPersonId(rule({ purpose: 'ROBOT', coachId: null, clientId: 'client-1' })),
      'client-1',
    );
  });

  it('у прочего никого', () => {
    assert.equal(attachedPersonId(rule({ purpose: 'OTHER', coachId: null })), null);
  });
});

describe('slotsForDate', () => {
  const template = [rule({ weekday: 2 }), rule({ weekday: 3, tableId: 't2' })];

  it('без правленого дня действует шаблон нужного дня недели', () => {
    const slots = slotsForDate(template, null, 2);

    assert.equal(slots.length, 1);
    assert.equal(slots[0]?.startMinute, 900);
  });

  it('правленый день заменяет шаблон целиком', () => {
    // Иначе убрать одно занятие в одну субботу было бы нечем: шаблон всё
    // равно закрывал бы это время.
    const slots = slotsForDate(template, { customised: true, closures: [dayClosure()] }, 2);

    assert.equal(slots.length, 1);
    assert.equal(slots[0]?.purpose, 'RENT');
  });

  it('пустой правленый день означает «всё свободно», а не «вернуть шаблон»', () => {
    assert.deepEqual(slotsForDate(template, { customised: true, closures: [] }, 2), []);
  });

  it('неправленый день с пустым списком всё равно берёт шаблон', () => {
    assert.equal(slotsForDate(template, { customised: false, closures: [] }, 2).length, 1);
  });
});

describe('formatMinutes', () => {
  it('показывает время с ведущими нулями', () => {
    assert.equal(formatMinutes(0), '00:00');
    assert.equal(formatMinutes(9 * 60 + 5), '09:05');
    assert.equal(formatMinutes(15 * 60), '15:00');
  });

  it('конец суток показывает как 24:00, а не 00:00', () => {
    assert.equal(formatMinutes(1440), '24:00');
  });
});
