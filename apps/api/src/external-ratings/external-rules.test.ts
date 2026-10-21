import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  fntrCandidate,
  matchPerson,
  normalizeName,
  parseRttwPage,
  profileUrl,
  planSync,
  rttwLetter,
  uniqueClaims,
  type Candidate,
} from './external-rules.ts';

const candidate = (overrides: Partial<Candidate>): Candidate => ({
  externalId: '1',
  lastName: 'Самсонов',
  firstName: 'Михаил',
  middleName: null,
  birthDate: null,
  city: 'Иркутск',
  rating: 320,
  place: 821,
  asOf: '2026-10-01',
  ...overrides,
});

describe('normalizeName', () => {
  it('регистр, «ё» и знак вопроса вместо неизвестного отчества', () => {
    assert.equal(normalizeName('  Ковалёв  АРТЁМ ? '), 'ковалев артем');
  });
});

describe('matchPerson — источник с датами рождения (ФНТР, RTTF)', () => {
  const person = { fullName: 'Самсонов Михаил Игоревич', birthDate: new Date('2010-05-03T00:00:00Z'), gender: 'MALE' as const, cities: [] };

  it('фамилия, имя и год совпали — нашли', () => {
    const result = matchPerson(person, [candidate({ birthDate: '2010-05-03' }), candidate({ externalId: '2', firstName: 'Алексей', birthDate: '1980-10-16' })]);

    assert.equal(result.found && result.candidate.externalId, '1');
  });

  it('тёзка другого года — не наш', () => {
    assert.deepEqual(matchPerson(person, [candidate({ birthDate: '2009-04-20' })]), { found: false, reason: 'NOT_FOUND' });
  });

  it('два тёзки одного года — решает полная дата', () => {
    const result = matchPerson(person, [
      candidate({ externalId: 'a', birthDate: '2010-01-01' }),
      candidate({ externalId: 'b', birthDate: '2010-05-03' }),
    ]);

    assert.equal(result.found && result.candidate.externalId, 'b');
  });

  it('два тёзки с одной датой — пропуск, а не первый попавшийся', () => {
    const twins = [candidate({ externalId: 'a', birthDate: '2010-05-03' }), candidate({ externalId: 'b', birthDate: '2010-05-03' })];

    const result = matchPerson(person, twins);

    assert.equal(!result.found && result.reason, 'AMBIGUOUS');
    assert.deepEqual(!result.found && result.reason === 'AMBIGUOUS' && result.candidates.map((row) => row.externalId), ['a', 'b']);
  });

  it('своей даты рождения нет — не ищем вовсе', () => {
    assert.deepEqual(
      matchPerson({ ...person, birthDate: null }, [candidate({ birthDate: '2010-05-03' })]),
      { found: false, reason: 'NO_BIRTH_DATE' },
    );
  });

  it('«ё» в фамилии не мешает', () => {
    const result = matchPerson(
      { fullName: 'Ковалёв Артём', birthDate: new Date('1985-01-01T00:00:00Z'), gender: null, cities: [] },
      [candidate({ lastName: 'Ковалев', firstName: 'Артем', birthDate: '1985-01-01' })],
    );

    assert.equal(result.found, true);
  });
});

describe('matchPerson — источник без дат (RTTW)', () => {
  const person = { fullName: 'Яббаров Ильхам Фуатович', birthDate: null, gender: null, cities: ['Казань'] };

  it('сверка по отчеству: брат с тем же именем не мешает', () => {
    const result = matchPerson(person, [
      candidate({ externalId: 'x', lastName: 'Яббаров', firstName: 'Ильхам', middleName: 'Фуатович', city: 'Республика Татарстан, Казань' }),
      candidate({ externalId: 'y', lastName: 'Яббаров', firstName: 'Ильхам', middleName: 'Ринатович', city: 'Республика Татарстан, Казань' }),
    ]);

    assert.equal(result.found && result.candidate.externalId, 'x');
  });

  it('двое без отчества — пропуск', () => {
    const result = matchPerson(person, [
      candidate({ externalId: 'x', lastName: 'Яббаров', firstName: 'Ильхам', city: 'Казань' }),
      candidate({ externalId: 'y', lastName: 'Яббаров', firstName: 'Ильхам', city: 'Казань' }),
    ]);

    assert.equal(!result.found && result.reason, 'AMBIGUOUS');
  });

  it('полный тёзка из другого города — не наш', () => {
    const result = matchPerson(person, [
      candidate({ lastName: 'Яббаров', firstName: 'Ильхам', middleName: 'Фуатович', city: 'Забайкальский кр., Чита' }),
    ]);

    assert.deepEqual(result, { found: false, reason: 'NOT_FOUND' });
  });

  it('город кусочком слова не считается: «Чита» — не «Читинский»', () => {
    const result = matchPerson({ ...person, cities: ['Чита'] }, [
      candidate({ lastName: 'Яббаров', firstName: 'Ильхам', middleName: 'Фуатович', city: 'Читинский р-н' }),
    ]);

    assert.equal(result.found, false);
  });

  it('у человека нет клубов — без города не ищем', () => {
    assert.deepEqual(
      matchPerson({ ...person, cities: [] }, [candidate({ lastName: 'Яббаров', firstName: 'Ильхам', city: 'Казань' })]),
      { found: false, reason: 'NO_CITY' },
    );
  });

  it('учётка без отчества и единственный кандидат — нашли', () => {
    const result = matchPerson({ ...person, fullName: 'Яббаров Ильхам' }, [candidate({ lastName: 'Яббаров', firstName: 'Ильхам', middleName: 'Фуатович', city: 'Казань' })]);

    assert.equal(result.found, true);
  });
});

describe('planSync — «выберите себя»', () => {
  const ivanov = (userId: string) => ({
    userId,
    person: { fullName: 'Иванов Пётр Сергеевич', birthDate: new Date('1990-03-01T00:00:00Z'), gender: 'MALE' as const, cities: [] },
    claimedId: null as string | null,
  });
  const twins = [
    candidate({ externalId: 'a', lastName: 'Иванов', firstName: 'Пётр', birthDate: '1990-03-01', rating: 900 }),
    candidate({ externalId: 'b', lastName: 'Иванов', firstName: 'Пётр', birthDate: '1990-03-01', rating: 300 }),
  ];

  it('двое в источнике — плашки нет, человеку оба варианта', () => {
    const plan = planSync([ivanov('u1')], () => twins, new Map());

    assert.deepEqual(plan.ratings, []);
    assert.deepEqual(plan.clear, ['u1']);
    assert.deepEqual(plan.choices.map((row) => [row.userId, row.candidates.map((c) => c.externalId)]), [['u1', ['a', 'b']]]);
  });

  it('закрепивший сам не перевыбирается — только обновляются числа', () => {
    const plan = planSync([{ ...ivanov('u1'), claimedId: 'b' }], () => twins, new Map([['b', 'u1']]));

    assert.deepEqual(plan.ratings.map((row) => [row.userId, row.candidate.externalId, row.claimed]), [['u1', 'b', true]]);
    assert.deepEqual(plan.clear, []);
  });

  it('профиль, закреплённый другим, второму тёзке не предлагается — остальное достаётся сразу', () => {
    const plan = planSync([ivanov('u2')], () => twins, new Map([['b', 'u1']]));

    assert.deepEqual(plan.ratings.map((row) => [row.userId, row.candidate.externalId, row.claimed]), [['u2', 'a', false]]);
  });

  it('один профиль на двоих наших — каждому «это вы?»', () => {
    const plan = planSync([ivanov('u1'), ivanov('u2')], () => [twins[0]!], new Map());

    assert.deepEqual(plan.ratings, []);
    assert.deepEqual(plan.clear.sort(), ['u1', 'u2']);
    assert.deepEqual(plan.choices.map((row) => [row.userId, row.candidates.map((c) => c.externalId)]), [['u1', ['a']], ['u2', ['a']]]);
  });

  it('источник не скачался — человек не тронут', () => {
    const plan = planSync([ivanov('u1')], () => null, new Map());

    assert.deepEqual(plan, { ratings: [], choices: [], clear: [], reasons: {} });
  });
});

describe('uniqueClaims', () => {
  it('профиль, подошедший девяти учёткам, не достаётся никому', () => {
    const shared = candidate({ externalId: '5d9c3c1' });
    const { kept, contested } = uniqueClaims([
      { userId: 'a', candidate: shared },
      { userId: 'b', candidate: shared },
      { userId: 'c', candidate: candidate({ externalId: '9' }) },
    ]);

    assert.deepEqual(kept.map((row) => row.userId), ['c']);
    assert.deepEqual(contested, ['a', 'b']);
  });
});

describe('разбор источников', () => {
  it('строка ФНТР', () => {
    const row = fntrCandidate({
      id: 18616,
      first_name: 'Михаил',
      last_name: 'Самсонов',
      birthday: '2010-05-03',
      score: 320,
      place: 821,
      month: 10,
      year: 2026,
    });

    assert.deepEqual(row, candidate({ externalId: '18616', birthDate: '2010-05-03', city: null }));
    assert.equal(fntrCandidate({ id: 1, first_name: 'А', last_name: 'Б', birthday: null, score: null, place: null, month: null, year: null }), null);
  });

  it('страница буквы RTTW: имя, рейтинг, дата; инициалы пропускаются', () => {
    const html = `
      <table><tr><th>Игрок</th></tr>
      <tr><td><a href="/players/?id=79aacdc">А О Абрамович</a></td><td>Чита</td><td>3</td><td>18</td><td>7-11</td><td>291</td><td>0.00</td><td>26.12.2022</td><td></td></tr>
      <tr><td><a href="/players/?id=1e355b1">Яббаров Ильхам Фуатович</a></td><td>Казань</td><td>12</td><td>80</td><td>40-40</td><td>512.5</td><td>+2.48</td><td>12.10.2026</td><td></td></tr>
      <tr><td><a href="/players/?id=2b">Ябанжи Ольга ?</a></td><td>--</td><td>1</td><td>4</td><td>1-3</td><td>294</td><td>0.00</td><td>22.12.2025</td><td></td></tr>
      </table>`;

    assert.deepEqual(parseRttwPage(html), [
      { externalId: '1e355b1', lastName: 'Яббаров', firstName: 'Ильхам', middleName: 'Фуатович', birthDate: null, city: 'Казань', rating: 513, place: null, asOf: '2026-10-12' },
      { externalId: '2b', lastName: 'Ябанжи', firstName: 'Ольга', middleName: null, birthDate: null, city: null, rating: 294, place: null, asOf: '2025-12-22' },
    ]);
  });

  it('буква RTTW и ссылки на профили', () => {
    assert.equal(rttwLetter('ёлкин Иван'), 'Е');
    assert.equal(rttwLetter('Самсонов'), 'С');
    assert.equal(profileUrl('FNTR', '9'), 'https://ttfr.ru/sportsman/9');
    assert.equal(profileUrl('RTTW', '79aacdc'), 'https://r.ttw.ru/players/?id=79aacdc');
  });
});
