import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  attendancePhase,
  autoNoShowAt,
  decideAutoNoShow,
  decideMark,
  escalationDue,
  noShowRatio,
  type AttendancePolicy,
  type EntryState,
  type MarkRequest,
} from './attendance-rules.ts';

const START = new Date('2026-09-12T12:00:00Z');
const END = new Date('2026-09-12T13:30:00Z');
const AFTER = new Date('2026-09-12T14:00:00Z');

const entry = (over: Partial<EntryState> = {}): EntryState => ({
  status: 'BOOKED',
  chargeRatio: null,
  startsAt: START,
  ...over,
});

/** Политика «Енисея»: неявка — 100%. */
const decide = (state: EntryState, request: MarkRequest, now = AFTER, percent = 100) =>
  decideMark(state, request, { now, noShowChargePercent: percent });

describe('decideMark — когда отмечать нельзя', () => {
  it('отменённую запись не отмечают', () => {
    const decision = decide(entry({ status: 'CANCELLED', chargeRatio: 50 }), { status: 'ATTENDED' });

    assert.deepEqual(decision, { ok: false, error: 'Запись отменена — отмечать нечего' });
  });

  it('до начала отмечать нельзя', () => {
    const decision = decide(entry(), { status: 'ATTENDED' }, new Date('2026-09-12T11:59:00Z'));

    assert.equal(decision.ok, false);
    assert.match(!decision.ok ? decision.error : '', /Ещё не началось/);
  });

  /** Граница включительно — та же, что у запрета отмены. */
  it('в момент начала уже можно', () => {
    assert.equal(decide(entry(), { status: 'ATTENDED' }, START).ok, true);
  });

  it('во время занятия можно: людей отмечают по мере прихода', () => {
    assert.equal(decide(entry(), { status: 'ATTENDED' }, new Date('2026-09-12T12:10:00Z')).ok, true);
  });

  it('верхней границы нет: вчерашнее отмечается и сегодня', () => {
    assert.equal(decide(entry(), { status: 'NO_SHOW' }, new Date('2026-09-20T12:00:00Z')).ok, true);
  });
});

describe('decideMark — первая отметка', () => {
  it('пришёл — полное списание, без причины', () => {
    assert.deepEqual(decide(entry(), { status: 'ATTENDED' }), {
      ok: true,
      changed: true,
      status: 'ATTENDED',
      chargeRatio: 100,
      reason: null,
      correction: false,
    });
  });

  it('неявка — процент клуба на момент отметки', () => {
    const decision = decide(entry(), { status: 'NO_SHOW' }, AFTER, 70);

    assert.equal(decision.ok && decision.changed && decision.chargeRatio, 70);
    assert.equal(decision.ok && decision.changed && decision.correction, false);
  });

  it('причина у первой отметки не обязательна, но сохраняется', () => {
    const decision = decide(entry(), { status: 'ATTENDED', reason: '  опоздал на 20 минут ' });

    assert.equal(decision.ok && decision.changed && decision.reason, 'опоздал на 20 минут');
  });

  it('неявку прощают сразу, если есть причина', () => {
    const decision = decide(entry(), { status: 'NO_SHOW', waiveCharge: true, reason: 'сломался стол' });

    assert.equal(decision.ok && decision.changed && decision.chargeRatio, 0);
    assert.equal(decision.ok && decision.changed && decision.correction, false);
  });
});

describe('decideMark — прощение неявки', () => {
  it('без причины не прощается', () => {
    assert.deepEqual(decide(entry(), { status: 'NO_SHOW', waiveCharge: true }), {
      ok: false,
      error: 'Чтобы простить неявку, укажите причину',
    });
  });

  it('причина из одних пробелов — не причина', () => {
    const decision = decide(entry(), { status: 'NO_SHOW', waiveCharge: true, reason: '   ' });

    assert.equal(decision.ok, false);
  });

  it('у присутствия прощать нечего', () => {
    const decision = decide(entry(), { status: 'ATTENDED', waiveCharge: true, reason: 'клуб виноват' });

    assert.deepEqual(decision, { ok: false, error: 'Простить списание можно только у неявки' });
  });

  it('поставленную неявку прощают как исправление', () => {
    const decision = decide(entry({ status: 'NO_SHOW', chargeRatio: 100 }), {
      status: 'NO_SHOW',
      waiveCharge: true,
      reason: 'позвонил, заболел',
    });

    assert.equal(decision.ok && decision.changed && decision.chargeRatio, 0);
    assert.equal(decision.ok && decision.changed && decision.correction, true);
  });

  it('уже прощённую прощать повторно незачем', () => {
    const decision = decide(entry({ status: 'NO_SHOW', chargeRatio: 0 }), {
      status: 'NO_SHOW',
      waiveCharge: true,
      reason: 'повтор',
    });

    assert.deepEqual(decision, { ok: true, changed: false });
  });

  it('прощённую неявку можно снова сделать списываемой — с причиной', () => {
    const state = entry({ status: 'NO_SHOW', chargeRatio: 0 });

    assert.equal(decide(state, { status: 'NO_SHOW' }).ok, false);

    const decision = decide(state, { status: 'NO_SHOW', reason: 'простили по ошибке' }, AFTER, 80);
    assert.equal(decision.ok && decision.changed && decision.chargeRatio, 80);
  });
});

describe('decideMark — повтор ничего не меняет', () => {
  it('пришёл → пришёл', () => {
    assert.deepEqual(decide(entry({ status: 'ATTENDED', chargeRatio: 100 }), { status: 'ATTENDED' }), {
      ok: true,
      changed: false,
    });
  });

  it('неявка → неявка', () => {
    assert.deepEqual(decide(entry({ status: 'NO_SHOW', chargeRatio: 100 }), { status: 'NO_SHOW' }), {
      ok: true,
      changed: false,
    });
  });

  /**
   * Клуб поменял процент неявки после отметки. Повторное «не пришёл» не должно
   * превращаться в исправление и требовать причину — и тем более
   * пересчитывать уже снятый процент по новой политике.
   */
  it('неявка → неявка после смены политики сохраняет снятый процент', () => {
    const decision = decide(entry({ status: 'NO_SHOW', chargeRatio: 100 }), { status: 'NO_SHOW' }, AFTER, 50);

    assert.deepEqual(decision, { ok: true, changed: false });
  });
});

describe('decideMark — исправление', () => {
  it('пришёл → неявка требует причину', () => {
    assert.deepEqual(decide(entry({ status: 'ATTENDED', chargeRatio: 100 }), { status: 'NO_SHOW' }), {
      ok: false,
      error: 'Отметка уже стоит — чтобы исправить её, укажите причину',
    });
  });

  it('пришёл → неявка с причиной — по нынешнему проценту клуба', () => {
    const decision = decide(
      entry({ status: 'ATTENDED', chargeRatio: 100 }),
      { status: 'NO_SHOW', reason: 'перепутал с однофамильцем' },
      AFTER,
      60,
    );

    assert.deepEqual(decision, {
      ok: true,
      changed: true,
      status: 'NO_SHOW',
      chargeRatio: 60,
      reason: 'перепутал с однофамильцем',
      correction: true,
    });
  });

  it('неявка → пришёл требует причину', () => {
    const state = entry({ status: 'NO_SHOW', chargeRatio: 100 });

    assert.equal(decide(state, { status: 'ATTENDED' }).ok, false);

    const decision = decide(state, { status: 'ATTENDED', reason: 'пришёл к концу' });
    assert.equal(decision.ok && decision.changed && decision.status, 'ATTENDED');
    assert.equal(decision.ok && decision.changed && decision.chargeRatio, 100);
  });

  /** Неявку поставила джоба — исправить её администратор может так же. */
  it('автонеявку исправляют как обычную', () => {
    const decision = decide(entry({ status: 'NO_SHOW', chargeRatio: 100 }), {
      status: 'ATTENDED',
      reason: 'забыли отметить',
    });

    assert.equal(decision.ok && decision.changed && decision.correction, true);
  });
});

describe('autoNoShowAt и decideAutoNoShow', () => {
  const policy: AttendancePolicy = {
    reminderAfterMinutes: 60,
    autoNoShowAfterMinutes: 1440,
    trackedSince: new Date('2026-09-01T00:00:00Z'),
  };
  const dayLater = new Date(END.getTime() + 1440 * 60_000);

  it('срок — окончание плюс минуты политики', () => {
    assert.deepEqual(autoNoShowAt(END, policy), dayLater);
  });

  it('до срока не трогает', () => {
    assert.equal(
      decideAutoNoShow({ status: 'BOOKED', endsAt: END }, policy, new Date(dayLater.getTime() - 1)),
      false,
    );
  });

  it('в срок и позже — неявка', () => {
    assert.equal(decideAutoNoShow({ status: 'BOOKED', endsAt: END }, policy, dayLater), true);
    assert.equal(decideAutoNoShow({ status: 'BOOKED', endsAt: END }, policy, new Date('2026-10-01')), true);
  });

  it('отмеченное и отменённое не трогает', () => {
    for (const status of ['ATTENDED', 'NO_SHOW', 'CANCELLED'] as const) {
      assert.equal(decideAutoNoShow({ status, endsAt: END }, policy, new Date('2026-10-01')), false);
    }
  });

  /**
   * Всё прошедшее до появления отметки — `BOOKED`: отметить его было нечем.
   * Без отсечки первый же прогон записал бы в неявки всю историю клуба.
   */
  it('закончившееся до начала учёта не трогает никогда', () => {
    const old = new Date('2026-08-31T20:00:00Z');

    assert.equal(autoNoShowAt(old, policy), null);
    assert.equal(decideAutoNoShow({ status: 'BOOKED', endsAt: old }, policy, new Date('2026-10-01')), false);
  });
});

describe('attendancePhase', () => {
  const policy = { reminderAfterMinutes: 60 };
  const at = (iso: string) => attendancePhase({ startsAt: START, endsAt: END }, policy, new Date(iso));

  it('до начала — рано', () => {
    assert.equal(at('2026-09-12T11:59:59Z'), 'UPCOMING');
  });

  it('с начала до окончания — идёт', () => {
    assert.equal(at('2026-09-12T12:00:00Z'), 'ONGOING');
    assert.equal(at('2026-09-12T13:29:59Z'), 'ONGOING');
  });

  it('после окончания до напоминания — ждёт отметки', () => {
    assert.equal(at('2026-09-12T13:30:00Z'), 'AWAITING');
    assert.equal(at('2026-09-12T14:29:59Z'), 'AWAITING');
  });

  it('ровно через час после окончания — просрочено', () => {
    assert.equal(at('2026-09-12T14:30:00Z'), 'OVERDUE');
  });
});

describe('noShowRatio', () => {
  const plain = { subscriptionId: null, coachId: null };

  it('обычная запись — процент политики клуба', () => {
    assert.equal(noShowRatio('TRAINING', plain, 50), 50);
    assert.equal(noShowRatio('TABLE', plain, 30), 30);
    assert.equal(noShowRatio('TOURNAMENT', plain, 0), 0);
  });

  it('запись по абонементу — всегда 100: визит израсходован', () => {
    assert.equal(noShowRatio('TRAINING', { subscriptionId: 's1', coachId: null }, 50), 100);
    assert.equal(noShowRatio('TOURNAMENT', { subscriptionId: 's1', coachId: null }, 0), 100);
  });

  it('спарринг — всегда 100: стол простоял по вине тренера', () => {
    assert.equal(noShowRatio('TABLE', { subscriptionId: null, coachId: 'c1' }, 50), 100);
  });

  it('занятие с тренером спаррингом не считается', () => {
    // У записи на занятие тренер заполнен всегда — он ведёт группу. Без вида
    // записи в условии клиент платил бы за неявку на занятие все 100.
    assert.equal(noShowRatio('TRAINING', { subscriptionId: null, coachId: 'c1' }, 50), 50);
  });
});

describe('escalationDue: напоминание администраторам через час', () => {
  const policy: AttendancePolicy = {
    reminderAfterMinutes: 60,
    autoNoShowAfterMinutes: 1440,
    trackedSince: new Date('2026-09-01T00:00:00Z'),
  };
  const endsAt = new Date('2026-09-23T12:00:00Z');
  const open = { status: 'BOOKED' as const, endsAt, reminderSentAt: null };

  it('через час после окончания — пора, раньше — нет', () => {
    assert.equal(escalationDue(open, policy, new Date('2026-09-23T12:59:00Z')), false);
    assert.equal(escalationDue(open, policy, new Date('2026-09-23T13:00:00Z')), true);
  });

  it('напоминание одно: уже напомненной записи — нет', () => {
    assert.equal(escalationDue({ ...open, reminderSentAt: new Date() }, policy, new Date('2026-09-23T14:00:00Z')), false);
  });

  it('отмеченной — нет', () => {
    assert.equal(escalationDue({ ...open, status: 'ATTENDED' }, policy, new Date('2026-09-23T14:00:00Z')), false);
  });

  it('когда пора автонеявке — уже нет: о ней придёт итог джобы', () => {
    assert.equal(escalationDue(open, policy, new Date('2026-09-24T12:00:00Z')), false);
  });

  it('до начала учёта отметки — нет: отметить было нечем', () => {
    const early = { ...open, endsAt: new Date('2026-08-31T12:00:00Z') };

    assert.equal(escalationDue(early, policy, new Date('2026-08-31T14:00:00Z')), false);
  });
});
