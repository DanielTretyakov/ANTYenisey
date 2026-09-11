/**
 * Сквозная проверка авторизации живыми HTTP-запросами.
 *
 * Дополняет модульные тесты: те проверяют чистые функции, а здесь работает
 * вся цепочка — HTTP, валидация формы, guard'ы, Prisma, живой Postgres.
 *
 * Запуск (API должен быть уже поднят, база — с накатанным сидом):
 *   pnpm dev
 *   node apps/api/scripts/smoke-auth.mjs
 *
 * Скрипт на Node, а не на bash, ровно по одной причине: тела запросов
 * содержат кириллицу, а консоль Windows отдаёт её в своей кодировке, а не в
 * UTF-8 — фамилия «Иванов» доезжала до API мусором и не проходила проверку
 * допустимых символов. Здесь кодировку задаёт сам Node.
 *
 * Проверяются оба транспорта refresh-токена: браузерный (httpOnly-кука)
 * и мобильный (тело ответа по заголовку `X-Auth-Transport: body`).
 *
 * ВНИМАНИЕ: заводит в базе тестовых пользователей probe-*@example.com и
 * НЕ убирает их за собой — доступа к базе у него нет, только HTTP. Уборка
 * отдельной командой: pnpm db:clean-probes. Направлять только на базу
 * разработки.
 */
const API = process.env.SMOKE_API_URL ?? 'http://127.0.0.1:3001/api';
const RUN = Date.now();
const PASSWORD = 'ochen-dlinnyi-parol-123';

let passed = 0;
let failed = 0;

function check(title, expected, actual, extra = '') {
  if (expected === actual) {
    passed += 1;
    console.log(`  OK     ${title} (HTTP ${actual})${extra}`);
  } else {
    failed += 1;
    console.log(`  ПРОВАЛ ${title}: ожидался HTTP ${expected}, получен ${actual}${extra}`);
  }
}

function assert(title, condition) {
  if (condition) {
    passed += 1;
    console.log(`  OK     ${title}`);
  } else {
    failed += 1;
    console.log(`  ПРОВАЛ ${title}`);
  }
}

/**
 * Заголовок мобильного клиента: просит отдать refresh-токен в теле ответа.
 * Браузер его не шлёт и получает токен только в httpOnly-куке, поэтому
 * сценарии ниже делятся на два транспорта — `post` (мобильный) и `browser`.
 */
const MOBILE = { 'X-Auth-Transport': 'body' };

async function call(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...options.headers,
    },
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return { status: response.status, body, setCookie: response.headers.getSetCookie() };
}

/** Мобильный клиент: токен приезжает в теле. */
const post = (path, json) => call(path, { method: 'POST', json, headers: MOBILE });

/** Браузерный клиент: без заголовка транспорта, с ручной передачей куки. */
const browser = (path, json, cookie) =>
  call(path, { method: 'POST', json, cookie });

/** Разбор Set-Cookie: значение и список атрибутов. */
function cookieFrom(setCookie, name) {
  const raw = (setCookie ?? []).find((item) => item.startsWith(`${name}=`));

  if (!raw) return null;

  const [pair, ...attrs] = raw.split(';').map((part) => part.trim());

  return {
    value: pair.slice(name.length + 1),
    attrs,
    header: `${name}=${pair.slice(name.length + 1)}`,
    has: (attr) => attrs.some((item) => item.toLowerCase() === attr.toLowerCase()),
    get: (key) => {
      const found = attrs.find((item) => item.toLowerCase().startsWith(`${key.toLowerCase()}=`));
      return found ? found.slice(key.length + 1) : null;
    },
  };
}

const REFRESH_COOKIE = 'yenisey_refresh';

/**
 * Местное время клуба -> мгновение ISO-8601, подбором смещения.
 *
 * Та же арифметика, что в `instantAt` на сервере: сетка доступности отдаётся
 * в минутах от местной полуночи, а бронь заводится мгновением.
 */
function instantAt(date, minute, timezone) {
  const target = Date.parse(`${date}T00:00:00Z`) + minute * 60_000;
  let instant = new Date(target);

  for (let pass = 0; pass < 2; pass += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);

    const value = (type) => parts.find((part) => part.type === type)?.value ?? '';
    const actual =
      Date.parse(`${value('year')}-${value('month')}-${value('day')}T00:00:00Z`) +
      (Number(value('hour')) * 60 + Number(value('minute'))) * 60_000;

    if (actual === target) break;

    instant = new Date(instant.getTime() - (actual - target));
  }

  return instant.toISOString();
}

/** Дата через `offset` суток от сегодняшней по времени клуба. */
function dateIn(timezone, offset) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  return new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Полный набор полей регистрации; отдельные поля перекрываются точечно.
 *
 * tenantSlug остаётся: аккаунт заводится на платформе, но человек, пришедший
 * со страницы клуба, сразу становится его клиентом — именно этот путь и
 * проверяется ниже.
 */
const registration = (overrides = {}) => ({
  tenantSlug: 'yenisey',
  email: `probe-${RUN}-${Math.random().toString(36).slice(2, 8)}@example.com`,
  password: PASSWORD,
  lastName: 'Иванов',
  firstName: 'Пётр',
  middleName: 'Сергеевич',
  phone: '+79991234567',
  birthDate: '2001-05-17',
  ...overrides,
});

async function main() {
  console.log('=== 1. Регистрация нового клиента');
  const first = registration();
  let r = await post('/auth/register', first);
  check('регистрация', 201, r.status);

  const access = r.body?.accessToken ?? '';
  const refresh = r.body?.refreshToken ?? '';
  assert(
    `ФИО собрано как «Иванов Пётр Сергеевич» (получено «${r.body?.user?.fullName}»)`,
    r.body?.user?.fullName === 'Иванов Пётр Сергеевич',
  );
  // Роли в профиле больше нет: она у пары «человек + клуб».
  assert('в профиле нет роли и клуба — аккаунт платформенный',
    !('role' in (r.body?.user ?? {})) && !('tenantId' in (r.body?.user ?? {})));
  assert('регистрация со страницы клуба сразу дала роль CLIENT в нём',
    r.body?.user?.memberships?.some((m) => m.slug === 'yenisey' && m.role === 'CLIENT') === true);

  console.log('=== 2. Повторная регистрация того же адреса');
  r = await post('/auth/register', registration({ email: first.email }));
  check('занятый email отклонён', 409, r.status);
  const takenMessage = r.body?.message;

  console.log('=== 3. Регистрация в несуществующий клуб');
  r = await post('/auth/register', registration({ tenantSlug: 'net-takogo-kluba' }));
  check('чужой клуб отклонён', 409, r.status);
  assert('текст ошибки не отличает чужой клуб от занятой почты', r.body?.message === takenMessage);

  console.log('=== 4. Попытка выдать себе роль владельца через лишнее поле');
  r = await post('/auth/register', registration({ role: 'OWNER' }));
  check('лишнее поле role отрезано', 400, r.status);

  console.log('=== 5. Проверка ФИО');
  r = await post('/auth/register', registration({ middleName: undefined }));
  check('без отчества отклонено', 400, r.status);
  r = await post('/auth/register', registration({ lastName: 'Иванов1' }));
  check('цифры в фамилии отклонены', 400, r.status);
  r = await post('/auth/register', registration({ lastName: '  Салтыков  Щедрин  ' }));
  check('лишние пробелы в фамилии схлопнуты', 201, r.status);
  assert(
    `двойной пробел не доехал до базы (получено «${r.body?.user?.fullName}»)`,
    r.body?.user?.fullName === 'Салтыков Щедрин Пётр Сергеевич',
  );

  console.log('=== 5б. Проверка даты рождения');
  r = await post('/auth/register', registration({ birthDate: undefined }));
  check('без даты рождения отклонено', 400, r.status);
  r = await post('/auth/register', registration({ birthDate: '17.05.2001' }));
  check('дата не в том формате отклонена', 400, r.status);
  r = await post('/auth/register', registration({ birthDate: '2099-01-01' }));
  check('дата в будущем отклонена', 409, r.status);
  r = await post('/auth/register', registration({ birthDate: '2001-02-31' }));
  check('несуществующая дата отклонена', 409, r.status);

  console.log('=== 6. Проверка телефона');
  r = await post('/auth/register', registration({ phone: '88005553535' }));
  check('телефон без +7 отклонён', 400, r.status);
  r = await post('/auth/register', registration({ phone: '+7999123456' }));
  check('неполный номер отклонён', 400, r.status);

  console.log('=== 7. Защищённый маршрут');
  r = await call('/auth/me', { headers: { Authorization: `Bearer ${access}` } });
  check('с токеном', 200, r.status);
  r = await call('/auth/me');
  check('без токена', 401, r.status);
  r = await call('/auth/me', { headers: { Authorization: 'Bearer poddelka.poddelka.poddelka' } });
  check('с подделанным токеном', 401, r.status);
  r = await call('/auth/me', { headers: { Authorization: `Bearer ${refresh}` } });
  check('refresh-токен не принимается как access', 401, r.status);

  console.log('=== 8. Вход');
  r = await post('/auth/login', {
    email: first.email,
    password: PASSWORD,
  });
  check('верный пароль', 200, r.status);
  r = await post('/auth/login', {
    email: first.email,
    password: 'nevernyi-parol-123',
  });
  check('неверный пароль', 401, r.status);
  r = await post('/auth/login', {
    email: `net-takogo-${RUN}@example.com`,
    password: PASSWORD,
  });
  check('несуществующий клиент', 401, r.status);

  console.log('=== 9. Ротация refresh-токена');
  r = await post('/auth/refresh', { refreshToken: refresh });
  check('обмен на новую пару', 200, r.status);
  const rotated = r.body?.refreshToken;
  assert('выдан новый токен, не тот же самый', rotated && rotated !== refresh);

  console.log('=== 10. Повторное использование погашенного токена');
  r = await post('/auth/refresh', { refreshToken: refresh });
  check('старый токен отвергнут', 401, r.status);
  r = await post('/auth/refresh', { refreshToken: rotated });
  check('все сессии погашены после утечки', 401, r.status);

  console.log('=== 11. Выход');
  r = await post('/auth/login', {
    email: first.email,
    password: PASSWORD,
  });
  const forLogout = r.body?.refreshToken;
  r = await post('/auth/logout', { refreshToken: forLogout });
  check('выход', 204, r.status);
  r = await post('/auth/refresh', { refreshToken: forLogout });
  check('погашенный выходом токен не работает', 401, r.status);

  console.log('=== 12. Публичное название клуба');
  r = await call('/clubs/yenisey');
  check('клуб найден без авторизации', 200, r.status);
  assert(
    `отдано официальное название «${r.body?.name}»`,
    typeof r.body?.name === 'string' && r.body.name.length > 0,
  );
  assert(
    'наружу отдана карточка клуба: код, название, города, оформление',
    Object.keys(r.body ?? {}).sort().join(',') ===
      'accentColor,city,logoUrl,name,otherCities,slug',
  );
  assert(
    'часового пояса в карточке клуба больше НЕТ — он свойство зала',
    !('timezone' in (r.body ?? {})),
  );
  assert(
    'ни цен, ни политики отмены, ни статуса подписки в открытом ответе нет',
    !['noShowChargePercent', 'tableHourPrice', 'id'].some((key) => key in (r.body ?? {})),
  );
  r = await call('/clubs/net-takogo-kluba');
  check('несуществующий клуб', 404, r.status);

  console.log('=== 13. Валидация формы целиком');
  r = await post('/auth/register', {
    email: 'ne-pochta',
    password: '123',
    lastName: 'Я',
    firstName: 'Я',
    middleName: 'Я',
    phone: '12345',
  });
  check('мусор в форме отклонён', 400, r.status);
  console.log(`     нарушений: ${r.body?.message?.length ?? 0}`);

  console.log('=== 14. Транспорт refresh-токена: браузер получает куку, а не тело');
  const cookieUser = registration();
  r = await browser('/auth/register', cookieUser);
  check('регистрация браузерным клиентом', 201, r.status);
  assert('refresh-токен НЕ отдан в теле ответа', r.body?.refreshToken === undefined);
  assert('access-токен в теле остался', typeof r.body?.accessToken === 'string');

  let jar = cookieFrom(r.setCookie, REFRESH_COOKIE);
  assert('выдана кука с refresh-токеном', jar !== null);
  assert('кука httpOnly — скрипт на странице её не прочитает', jar?.has('HttpOnly'));
  assert('SameSite=Lax — чужой сайт не дёрнет /auth/refresh', jar?.get('SameSite') === 'Lax');
  assert('путь куки сужен до ветви авторизации', jar?.get('Path') === '/api/auth');

  console.log('=== 15. Обновление и выход по куке, без тела запроса');
  r = await browser('/auth/refresh', undefined, jar.header);
  check('обмен по куке', 200, r.status);
  const rotatedJar = cookieFrom(r.setCookie, REFRESH_COOKIE);
  assert('выдана новая кука, не та же самая', rotatedJar && rotatedJar.value !== jar.value);
  assert('и здесь тело без refresh-токена', r.body?.refreshToken === undefined);

  r = await browser('/auth/refresh', undefined, jar.header);
  check('старая кука отвергнута (ротация работает)', 401, r.status);

  r = await browser('/auth/refresh', undefined);
  check('без куки и без тела — отказ', 401, r.status);

  // Предъявление погашенной куки выше сочтено утечкой и погасило все сессии,
  // поэтому для проверки выхода нужен свежий вход.
  r = await browser('/auth/login', {
    email: cookieUser.email,
    password: PASSWORD,
  });
  jar = cookieFrom(r.setCookie, REFRESH_COOKIE);
  r = await browser('/auth/logout', undefined, jar.header);
  check('выход по куке', 204, r.status);
  const cleared = cookieFrom(r.setCookie, REFRESH_COOKIE);
  assert('сервер погасил куку в браузере', cleared !== null && cleared.value === '');
  r = await browser('/auth/refresh', undefined, jar.header);
  check('погашенный выходом токен не работает', 401, r.status);

  console.log('=== 16. Ограничение подбора пароля');
  const victim = registration();
  await post('/auth/register', victim);

  const limit = Number(process.env.SMOKE_MAX_FAILED_ATTEMPTS ?? 10);
  let last = null;
  for (let attempt = 0; attempt < limit; attempt += 1) {
    last = await post('/auth/login', {
      email: victim.email,
      password: `nevernyi-parol-${attempt}`,
    });
  }
  check(`попытка №${limit} — ещё 401, лимит не превышен`, 401, last.status);

  r = await post('/auth/login', {
    email: victim.email,
    password: `nevernyi-parol-${limit}`,
  });
  check(`попытка №${limit + 1} — перебор остановлен`, 429, r.status);

  // Ключ окна — почта, поэтому заперта ровно одна учётка.
  r = await post('/auth/login', {
    email: first.email,
    password: PASSWORD,
  });
  check('вход в другую учётку не задет', 200, r.status);

  console.log('=== 17. Профиль клуба: кому закрыт');
  r = await call('/clubs/yenisey/settings');
  check('без токена', 401, r.status);
  r = await call('/clubs/yenisey/settings', { headers: { Authorization: `Bearer ${access}` } });
  check('клиенту закрыто', 403, r.status);
  r = await call('/clubs/yenisey/halls', { headers: { Authorization: `Bearer ${access}` } });
  check('залы клиенту закрыты', 403, r.status);

  const adminEmail = process.env.SMOKE_ADMIN_EMAIL;
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.log('=== 18-21. Настройки, залы и расписание — ПРОПУЩЕНЫ');
    console.log('     нужна учётка админа: SMOKE_ADMIN_EMAIL и SMOKE_ADMIN_PASSWORD');
    console.log('     завести: pnpm db:create-admin -- --email ... --password ... --name "..."');
  } else {
    console.log('=== 18. Настройки клуба');
    r = await post('/auth/login', {
      email: adminEmail,
      password: adminPassword,
    });
    check('вход администратора', 200, r.status);

    const adminAuth = { Authorization: `Bearer ${r.body?.accessToken ?? ''}` };
    const asAdmin = (path, options = {}) =>
      call(path, { ...options, headers: { ...adminAuth, ...options.headers } });
    const patchSettings = (json) => asAdmin('/clubs/yenisey/settings', { method: 'PATCH', json });

    r = await asAdmin('/clubs/yenisey/settings');
    check('настройки прочитаны', 200, r.status);
    const originalSettings = r.body;
    assert(
      'цен в настройках клуба больше нет — они у зала',
      originalSettings !== null && !('tableHourPrice' in originalSettings),
    );
    assert(
      'служебные поля наружу не утекают',
      originalSettings !== null && !('id' in originalSettings) && !('slug' in originalSettings),
    );

    r = await patchSettings({ timezone: 'Asia/Krasnayarsk' });
    check('опечатка в часовом поясе отклонена', 400, r.status);
    r = await patchSettings({
      attendanceReminderAfterMinutes: 120,
      attendanceAutoNoShowAfterMinutes: 60,
    });
    check('неявка раньше напоминания отклонена', 400, r.status);
    r = await patchSettings({ noShowChargePercent: 101 });
    check('процент больше ста отклонён', 400, r.status);
    r = await patchSettings({ tableHourPrice: 40000 });
    check('цена в настройках клуба больше не принимается', 400, r.status);

    console.log('=== 19. Залы');
    r = await asAdmin('/clubs/yenisey/halls');
    check('залы прочитаны', 200, r.status);
    const mainHall = r.body?.[0];
    assert('у зала есть цена аренды целым числом копеек', Number.isInteger(mainHall?.tableHourPrice));
    assert('у зала есть шаг бронирования', typeof mainHall?.bookingStep === 'string');

    const hallName = `Зал проверки ${RUN}`;
    r = await asAdmin('/clubs/yenisey/halls', {
      method: 'POST',
      json: {
        name: hallName,
        timezone: 'Asia/Krasnoyarsk',
        cityId: null,
        address: null,
        bookingStep: 'HOUR_1',
        tableHourPrice: 30000,
        tableExtra30MinPrice: 15000,
        hasRobotOption: false,
        robot30MinPrice: null,
        robot60MinPrice: null,
        robotExtra30MinPrice: null,
      },
    });
    check('зал заведён', 201, r.status);
    const hallId = r.body?.id;
    assert('у нового зала свои цены, а не общие клубные', r.body?.tableHourPrice === 30000);

    r = await asAdmin('/clubs/yenisey/halls', {
      method: 'POST',
      json: {
        name: hallName,
        timezone: 'Asia/Krasnoyarsk',
        cityId: null,
        address: null,
        bookingStep: 'MIN_30',
        tableHourPrice: 1,
        tableExtra30MinPrice: 1,
        hasRobotOption: false,
        robot30MinPrice: null,
        robot60MinPrice: null,
        robotExtra30MinPrice: null,
      },
    });
    check('повторное название зала отклонено', 409, r.status);

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}`, {
      method: 'PATCH',
      json: { hasRobotOption: true },
    });
    check('опция робота без цен отклонена', 400, r.status);
    assert(
      'в тексте перечислено, каких цен не хватает',
      JSON.stringify(r.body?.message ?? '').includes('30 минут'),
    );

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}`, { method: 'PATCH', json: { bookingStep: 'MIN_15' } });
    check('шаг бронирования зала изменён', 200, r.status);
    assert('ответ отдал новое значение', r.body?.bookingStep === 'MIN_15');

    console.log('=== 20. Столы в залах');
    const label = `Стол проверки ${RUN}`;
    r = await asAdmin('/clubs/yenisey/tables', { method: 'POST', json: { hallId, label } });
    check('стол заведён в зале', 201, r.status);
    const tableId = r.body?.id;
    assert('стол знает свой зал', r.body?.hallId === hallId);
    assert('у нового стола нет расписания', r.body?.closureCount === 0);

    r = await asAdmin('/clubs/yenisey/tables', { method: 'POST', json: { hallId, label } });
    check('повторное название в одном зале отклонено', 409, r.status);

    r = await asAdmin('/clubs/yenisey/tables', {
      method: 'POST',
      json: { hallId: mainHall?.id, label },
    });
    check('то же название в СОСЕДНЕМ зале принято', 201, r.status);
    const twinId = r.body?.id;

    r = await asAdmin('/clubs/yenisey/tables', { method: 'POST', json: { hallId: 'chuzhoy-zal', label: 'X' } });
    check('стол в несуществующий зал отклонён', 404, r.status);

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}`, { method: 'DELETE' });
    check('зал со столами удалить нельзя', 409, r.status);

    console.log('=== 21. Шаблон недели');
    const coaches = (await asAdmin('/clubs/yenisey/coaches')).body ?? [];
    const coachId = coaches[0]?.id ?? null;

    if (!coachId) {
      console.log('     тренеров в клубе нет — проверки тренировок пропущены');
      console.log('     завести: pnpm db:create-admin -- --role COACH --email ... --name "..."');
    }

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`);
    check('шаблон прочитан', 200, r.status);
    assert('у нового зала шаблон пуст', Array.isArray(r.body) && r.body.length === 0);

    const window = (extra) => ({
      tableId,
      weekday: 2,
      startMinute: 900,
      endMinute: 1140,
      purpose: 'RENT',
      coachId: null,
      clientId: null,
      trainingTypeId: null,
      tournamentId: null,
      tournamentTypeId: null,
      ...extra,
    });

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`, {
      method: 'PUT',
      json: { rules: [window(), window({ startMinute: 1140, endMinute: 1200 })] },
    });
    check('шаблон сохранён', 200, r.status);
    assert('окна встык приняты — стык пересечением не считается', r.body?.length === 2);

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`, {
      method: 'PUT',
      json: { rules: [window(), window({ startMinute: 1080, endMinute: 1200 })] },
    });
    check('наложение окон отклонено', 400, r.status);
    assert(
      'в тексте названы конфликтующие часы',
      JSON.stringify(r.body?.message ?? '').includes('15:00'),
    );

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`, {
      method: 'PUT',
      json: { rules: [window({ weekday: 0 })] },
    });
    check('нулевой день недели отклонён', 400, r.status);

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`, {
      method: 'PUT',
      json: { rules: [window({ endMinute: 1441 })] },
    });
    check('конец за пределами суток отклонён', 400, r.status);

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`, {
      method: 'PUT',
      json: { rules: [window({ purpose: 'TRAINING' })] },
    });
    check('тренировка без тренера отклонена', 400, r.status);
    assert(
      'сказано, почему тренер нужен',
      JSON.stringify(r.body?.message ?? '').includes('статистику'),
    );

    console.log('=== 21а. Справочники занятий и турниров');
    const trainingName = `Проверочная тренировка ${RUN}`;
    r = await asAdmin('/clubs/yenisey/training-types', {
      method: 'POST',
      json: { name: trainingName, price: 70000 },
    });
    check('тип тренировки заведён', 201, r.status);
    const trainingTypeId = r.body?.id;
    assert('цена целым числом копеек', r.body?.price === 70000);

    r = await asAdmin('/clubs/yenisey/training-types', {
      method: 'POST',
      json: { name: trainingName, price: 1 },
    });
    check('повторное название типа отклонено', 409, r.status);

    r = await asAdmin('/clubs/yenisey/training-types', { method: 'POST', json: { name: '  ', price: 1 } });
    check('пустое название отклонено', 400, r.status);

    r = await asAdmin('/clubs/yenisey/training-types', {
      method: 'POST',
      json: { name: `Дробная ${RUN}`, price: 700.5 },
    });
    check('дробная цена отклонена', 400, r.status);

    const tournamentTypeName = `Проверочный турнир ${RUN}`;
    r = await asAdmin('/clubs/yenisey/tournament-types', {
      method: 'POST',
      json: { name: tournamentTypeName, ratingLabel: '100', price: 50000 },
    });
    check('тип турнира заведён', 201, r.status);
    const tournamentTypeId = r.body?.id;
    assert('ограничение по рейтингу сохранено как справочная строка', r.body?.ratingLabel === '100');

    r = await asAdmin('/clubs/yenisey/tournaments', {
      method: 'POST',
      json: {
        tournamentTypeId,
        startsAt: '2026-10-03T04:00:00.000Z',
        endsAt: '2026-10-03T08:00:00.000Z',
      },
    });
    check('турнир заведён', 201, r.status);
    assert('окончание турнира сохранено', r.body?.endsAt === '2026-10-03T08:00:00.000Z');
    const tournamentId = r.body?.id;
    assert('название типа приехало вместе с турниром', r.body?.typeName === tournamentTypeName);

    r = await asAdmin('/clubs/yenisey/tournaments', {
      method: 'POST',
      json: {
        tournamentTypeId,
        startsAt: '2026-10-03T04:00:00.000Z',
        endsAt: '2026-10-03T04:00:00.000Z',
      },
    });
    check('турнир, кончающийся в момент начала, отклонён', 400, r.status);

    r = await asAdmin('/clubs/yenisey/tournaments', {
      method: 'POST',
      json: { tournamentTypeId, startsAt: '2026-10-03T04:00:00.000Z' },
    });
    check('турнир без окончания отклонён', 400, r.status);

    r = await asAdmin('/clubs/yenisey/tournaments', {
      method: 'POST',
      json: {
        tournamentTypeId: 'chuzhoy-tip',
        startsAt: '2026-10-03T04:00:00.000Z',
        endsAt: '2026-10-03T08:00:00.000Z',
      },
    });
    check('турнир по несуществующему типу отклонён', 404, r.status);

    r = await asAdmin(`/clubs/yenisey/tournament-types/${tournamentTypeId}`, { method: 'DELETE' });
    check('тип с заведёнными турнирами удалить нельзя', 409, r.status);

    if (coachId) {
      r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`, {
        method: 'PUT',
        json: { rules: [window({ purpose: 'TRAINING', coachId })] },
      });
      check('тренировка без типа отклонена', 400, r.status);
      assert(
        'сказано, что нужен тип',
        JSON.stringify(r.body?.message ?? '').includes('выберите тип'),
      );

      r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`, {
        method: 'PUT',
        json: { rules: [window({ purpose: 'TRAINING', coachId, trainingTypeId })] },
      });
      check('тренировка с тренером и типом принята', 200, r.status);
      assert('тренер сохранён', r.body?.[0]?.coachId === coachId);
      assert('тип сохранён', r.body?.[0]?.trainingTypeId === trainingTypeId);

      // В шаблоне недели турнир записывается ТИПОМ: у конкретного проведения
      // есть дата, а шаблон повторяется.
      r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`, {
        method: 'PUT',
        json: { rules: [window({ purpose: 'TOURNAMENT', tournamentId })] },
      });
      check('конкретное проведение в шаблон не принимается', 400, r.status);

      r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`, {
        method: 'PUT',
        json: { rules: [window({ purpose: 'TOURNAMENT', tournamentTypeId })] },
      });
      check('турнир типом в шаблоне принят', 200, r.status);
      assert('тип турнира сохранён', r.body?.[0]?.tournamentTypeId === tournamentTypeId);

      r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`, {
        method: 'PUT',
        json: { rules: [window({ purpose: 'TOURNAMENT' })] },
      });
      check('турнир в шаблоне без типа отклонён', 400, r.status);

      r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`, {
        method: 'PUT',
        json: { rules: [window({ purpose: 'TOURNAMENT', tournamentTypeId: 'chuzhoy-tip' })] },
      });
      check('неизвестный тип турнира отклонён', 400, r.status);

      r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`, {
        method: 'PUT',
        json: { rules: [window({ purpose: 'RENT', coachId })] },
      });
      check('тренер у аренды отклонён', 400, r.status);
    }

    console.log('=== 21д. Турнир в расписании дня');
    const cupDate = '2026-10-03';
    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/days/${cupDate}`, {
      method: 'PUT',
      json: {
        closures: [
          {
            tableId,
            startMinute: 600,
            endMinute: 720,
            purpose: 'TOURNAMENT',
            coachId: null,
            clientId: null,
            trainingTypeId: null,
            tournamentId,
          },
        ],
      },
    });
    check('турнир поставлен в сетку дня', 200, r.status);
    assert('турнир сохранён у окна', r.body?.closures?.[0]?.tournamentId === tournamentId);

    r = await asAdmin('/clubs/yenisey/tournaments');
    const placed = (r.body ?? []).find((item) => item.id === tournamentId);
    assert('турнир знает, что стоит в сетке', placed?.placedCount === 1);

    r = await asAdmin(`/clubs/yenisey/tournaments/${tournamentId}`, { method: 'DELETE' });
    check('турнир из сетки удалить нельзя', 409, r.status);

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/days/${cupDate}`, {
      method: 'PUT',
      json: {
        closures: [
          {
            tableId,
            startMinute: 600,
            endMinute: 720,
            purpose: 'TOURNAMENT',
            coachId: null,
            clientId: null,
            trainingTypeId: null,
            tournamentId: null,
          },
        ],
      },
    });
    check('турнир без указания какой — отклонён', 400, r.status);

    console.log('=== 21б. Клиент, закреплённый за арендой');
    const clients = (await asAdmin('/clubs/yenisey/people?role=CLIENT&limit=1')).body?.items ?? [];
    const clientId = clients[0]?.id ?? null;

    if (!clientId) {
      console.log('     клиентов в клубе нет — проверки аренды пропущены');
    } else {
      r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`, {
        method: 'PUT',
        json: { rules: [window({ purpose: 'RENT', clientId })] },
      });
      check('аренда с клиентом принята', 200, r.status);
      assert('клиент сохранён', r.body?.[0]?.clientId === clientId);

      r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`, {
        method: 'PUT',
        json: { rules: [window({ purpose: 'RENT', clientId: null })] },
      });
      check('аренда без клиента тоже принята', 200, r.status);

      r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`, {
        method: 'PUT',
        json: { rules: [window({ purpose: 'TRAINING', coachId, clientId })] },
      });
      check('клиент у тренировки отклонён', 400, r.status);

      // Поле, не присланное вовсе, — это undefined, а не null: проверки не
      // должны принимать его за заполненное.
      r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`, {
        method: 'PUT',
        json: {
          rules: [
            { tableId, weekday: 2, startMinute: 900, endMinute: 1140, purpose: 'OTHER' },
          ],
        },
      });
      check('окно без полей тренера и клиента принято', 200, r.status);
    }

    console.log('=== 21в. Состав клуба');
    r = await call('/clubs/yenisey/people', { headers: { Authorization: `Bearer ${access}` } });
    check('состав клуба клиенту закрыт', 403, r.status);

    r = await asAdmin('/clubs/yenisey/people?limit=5');
    check('состав прочитан', 200, r.status);
    assert('пришли и список, и общее число', Array.isArray(r.body?.items) && typeof r.body?.total === 'number');
    assert('страница не длиннее запрошенного', (r.body?.items?.length ?? 0) <= 5);

    r = await asAdmin('/clubs/yenisey/people?role=COACH');
    check('фильтр по роли', 200, r.status);
    assert(
      'в выборке только тренеры',
      Array.isArray(r.body?.items) && r.body.items.every((p) => p.role === 'COACH'),
    );

    r = await asAdmin('/clubs/yenisey/people?role=NEIZVESTNAYA');
    check('неизвестная роль отклонена', 400, r.status);

    r = await asAdmin('/clubs/yenisey/people?limit=999');
    check('запрос всего списка разом отклонён', 400, r.status);

    r = await asAdmin(`/clubs/yenisey/people?search=${encodeURIComponent(first.email)}`);
    check('поиск по почте', 200, r.status);
    assert('нашёлся ровно один', r.body?.total === 1);

    const probe = r.body?.items?.[0];
    assert('телефон и дата рождения пришли', Boolean(probe?.phone) && Boolean(probe?.birthDate));

    console.log('=== 21г. Смена роли');
    r = await asAdmin(`/clubs/yenisey/people/${probe.id}/role`, { method: 'PATCH', json: { role: 'COACH' } });
    check('клиент повышен до тренера', 200, r.status);
    assert('роль изменилась', r.body?.role === 'COACH');

    r = await asAdmin('/clubs/yenisey/coaches');
    assert(
      'и он появился в списке тренеров — значит, профиль тренера заведён',
      Array.isArray(r.body) && r.body.some((coach) => coach.id === probe.id),
    );

    r = await asAdmin(`/clubs/yenisey/people/${probe.id}/role`, { method: 'PATCH', json: { role: 'CLIENT' } });
    check('и разжалован обратно', 200, r.status);

    r = await asAdmin(`/clubs/yenisey/people/${probe.id}/role`, { method: 'PATCH', json: { role: 'CLIENT' } });
    check('повтор той же роли отклонён', 409, r.status);

    r = await asAdmin(`/clubs/yenisey/people/${probe.id}/role`, { method: 'PATCH', json: { role: 'KTO-TO' } });
    check('неизвестная роль отклонена', 400, r.status);

    // Себе роль менять нельзя: единственный владелец, разжаловавший себя,
    // запер бы клуб — вернуть роль было бы уже некому.
    const me = (await asAdmin('/auth/me')).body;
    r = await asAdmin(`/clubs/yenisey/people/${me?.id}/role`, { method: 'PATCH', json: { role: 'CLIENT' } });
    check('свою роль изменить нельзя', 409, r.status);

    // Стол СОСЕДНЕГО зала в расписание этого зала попасть не должен: составной
    // внешний ключ проверяет клуб, но не зал.
    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`, {
      method: 'PUT',
      json: { rules: [window({ tableId: twinId })] },
    });
    check('чужой стол в расписании зала отклонён', 400, r.status);

    console.log('=== 22. Расписание на дату');
    const date = '2026-09-12';
    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/days/${date}`);
    check('день прочитан', 200, r.status);
    assert('неправленый день помечен как неправленый', r.body?.customised === false);
    assert('и окон у него нет', Array.isArray(r.body?.closures) && r.body.closures.length === 0);

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/days/${date}`, {
      method: 'PUT',
      json: {
        closures: [
          { tableId, startMinute: 600, endMinute: 660, purpose: 'ROBOT', coachId: null },
        ],
      },
    });
    check('день сохранён', 200, r.status);
    assert('день отмечен как правленый', r.body?.customised === true);
    assert('назначение сохранено', r.body?.closures?.[0]?.purpose === 'ROBOT');

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/days`);
    check('список правленых дат прочитан', 200, r.status);
    assert('дата в списке', Array.isArray(r.body) && r.body.includes(date));

    // Пустое расписание правленого дня — осмысленное состояние: «в этот день
    // ничего не занято», а не «вернуть шаблон».
    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/days/${date}`, {
      method: 'PUT',
      json: { closures: [] },
    });
    check('пустой день сохранён', 200, r.status);
    assert('и он всё ещё правленый, а не сброшенный', r.body?.customised === true);

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/days/${date}`, {
      method: 'PUT',
      json: {
        closures: [
          { tableId, startMinute: 600, endMinute: 720, purpose: 'RENT', coachId: null },
          { tableId, startMinute: 660, endMinute: 780, purpose: 'RENT', coachId: null },
        ],
      },
    });
    check('наложение окон в дне отклонено', 400, r.status);

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/days/${date}`, { method: 'DELETE' });
    check('день возвращён к шаблону', 200, r.status);
    assert('признак правки снят', r.body?.customised === false);

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/days/2026-13-45`, { method: 'DELETE' });
    check('несуществующая дата отклонена', 400, r.status);

    console.log('=== 22о. Отвязка дня от шаблона и уборка ничьих мероприятий');
    // Шаблон зала на время сценария подменяется и потом возвращается как был:
    // от него зависят проверки ниже.
    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`);
    const templateBefore = (r.body ?? []).map(({ id: _id, ...rule }) => rule);

    // Вторник — как weekday: 2 у окон window().
    const detachDate = '2026-10-06';
    assert('дата отвязки — вторник', new Date(`${detachDate}T00:00:00Z`).getUTCDay() === 2);

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`, {
      method: 'PUT',
      json: {
        rules: [
          window({ startMinute: 600, endMinute: 660 }),
          window({ startMinute: 720, endMinute: 840, purpose: 'TOURNAMENT', tournamentTypeId }),
        ],
      },
    });
    check('шаблон с арендой и турниром сохранён', 200, r.status);

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/days/${detachDate}`);
    assert('до отвязки день идёт по шаблону', r.body?.customised === false);

    const tournamentIds = async () =>
      ((await asAdmin('/clubs/yenisey/tournaments')).body ?? []).map((item) => item.id);
    const tournamentsBefore = (await tournamentIds()).length;

    const detachPath = `/clubs/yenisey/halls/${hallId}/days/${detachDate}/detach`;
    const cupOf = (body) => (body?.closures ?? []).find((closure) => closure.purpose === 'TOURNAMENT');

    r = await asAdmin(detachPath, { method: 'POST' });
    check('день отвязан от шаблона', 200, r.status);
    assert('день стал правленым', r.body?.customised === true);
    assert('окна шаблона скопированы в день', r.body?.closures?.length === 2);
    const firstCup = cupOf(r.body)?.tournamentId;
    // Турнир заводится: окно турнира в дне обязано ссылаться на проведение.
    assert('у турнирного окна появилось проведение', typeof firstCup === 'string');
    // Занятия — нет: окно тренировки без занятия законно, а заводить запись на
    // каждое окно из шаблона значило бы открыть клиентам несобранные группы.
    assert(
      'занятий при отвязке не заводится',
      (r.body?.closures ?? []).every((closure) => closure.trainingSessionId === null),
    );

    r = await asAdmin(detachPath, { method: 'POST' });
    check('повторная отвязка не ошибка', 200, r.status);
    assert('повторная отвязка не заводит второй турнир', cupOf(r.body)?.tournamentId === firstCup);
    assert('заведён ровно один турнир', (await tournamentIds()).length === tournamentsBefore + 1);

    // Окончание турнира — конец его окон: по нему экран смены и джоба
    // автонеявки понимают, что турнир закончился.
    const cupSpan = async (id) => {
      const cup = ((await asAdmin('/clubs/yenisey/tournaments')).body ?? []).find((item) => item.id === id);
      return cup ? (Date.parse(cup.endsAt) - Date.parse(cup.startsAt)) / 60_000 : null;
    };
    assert('отвязанный турнир кончается с концом своих окон', (await cupSpan(firstCup)) === 120);

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/days/${detachDate}`, {
      method: 'PUT',
      json: {
        closures: [
          { tableId, startMinute: 600, endMinute: 660, purpose: 'RENT', coachId: null },
          { tableId, startMinute: 720, endMinute: 900, purpose: 'TOURNAMENT', coachId: null, tournamentId: firstCup },
        ],
      },
    });
    check('окно турнира растянуто правкой дня', 200, r.status);
    assert('окончание турнира пересчитано по окнам', (await cupSpan(firstCup)) === 180);

    // Правка, стирающая окно турнира, уносит и сам турнир: он больше нигде не
    // стоит, записей на нём нет, а клиент видел бы его в ленте.
    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/days/${detachDate}`, {
      method: 'PUT',
      json: {
        closures: [
          { tableId, startMinute: 600, endMinute: 660, purpose: 'RENT', coachId: null },
        ],
      },
    });
    check('окно турнира стёрто правкой дня', 200, r.status);
    assert('стёртый турнир ушёл вместе с окном', !(await tournamentIds()).includes(firstCup));

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/days/${detachDate}`, { method: 'DELETE' });
    check('правленый день возвращён к шаблону', 200, r.status);

    r = await asAdmin(detachPath, { method: 'POST' });
    const secondCup = cupOf(r.body)?.tournamentId;
    assert('после возврата день отвязывается заново', typeof secondCup === 'string');

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/days/${detachDate}`, { method: 'DELETE' });
    check('отвязанный день возвращён к шаблону', 200, r.status);
    assert('турнир, стоявший только в этом дне, ушёл вместе с днём', !(await tournamentIds()).includes(secondCup));

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/days/2026-13-45/detach`, { method: 'POST' });
    check('отвязка несуществующей даты отклонена', 400, r.status);

    r = await asAdmin(`/clubs/yenisey/halls/net-takogo-zala/days/${detachDate}/detach`, {
      method: 'POST',
    });
    check('отвязка в несуществующем зале', 404, r.status);

    r = await call(detachPath, { method: 'POST', headers: { Authorization: `Bearer ${access}` } });
    check('отвязка клиенту закрыта', 403, r.status);

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`, {
      method: 'PUT',
      json: { rules: templateBefore },
    });
    check('шаблон возвращён как был', 200, r.status);

    console.log('=== 24. Бронирование стола клиентом');
    // Бронь заводится в ОСНОВНОМ зале клуба, а не в зале проверки: за бронью
    // стоит платёж, внешний ключ стоит на Restrict, и стол с историей уже не
    // удалить — а зал проверки в конце убирается. Оставшиеся брони уносит
    // pnpm db:clean-probes вместе с probe-учётками.
    // Пояс берётся у ЗАЛА, а не у клуба: залы одной организации бывают в
    // разных регионах, и общий на клуб пояс сдвинул бы в одном из них границы
    // операционного дня и порог «за час до начала», от которого считаются
    // деньги.
    const timezone = mainHall?.timezone;
    assert('зал несёт свой часовой пояс', typeof timezone === 'string');

    r = await post('/auth/register', registration());
    check('клиент для брони заведён', 201, r.status);
    const bookerAuth = { Authorization: `Bearer ${r.body?.accessToken ?? ''}` };
    const asBooker = (path, options = {}) =>
      call(path, { ...options, headers: { ...bookerAuth, ...(options.headers ?? {}) } });

    r = await asBooker('/clubs/yenisey/booking/halls');
    check('клиент видит залы с ценами', 200, r.status);
    const bookingHall = r.body?.find((item) => item.id === mainHall?.id) ?? r.body?.[0];

    if (!bookingHall || !timezone) {
      console.log('     залов у клуба нет — бронирование пропущено');
    } else {
      const bookDate = dateIn(timezone, 1);

      r = await asBooker(`/clubs/yenisey/booking/halls/${bookingHall.id}/days/${bookDate}`);
      check('сетка доступности прочитана', 200, r.status);
      const bookingDay = r.body;
      assert('сетка знает шаг брони зала', Number.isInteger(bookingDay?.stepMinutes));
      assert(
        'сетка идёт с 06:00 до полуночи',
        bookingDay?.openMinute === 360 && bookingDay?.closeMinute === 1440,
      );
      assert('у столов сетки есть список занятого', Array.isArray(bookingDay?.tables?.[0]?.busy));

      r = await asBooker(`/clubs/yenisey/booking/halls/${bookingHall.id}/days/${dateIn(timezone, 60)}`);
      check('дата за горизонтом отклонена', 400, r.status);

      r = await asBooker(`/clubs/yenisey/booking/halls/${bookingHall.id}/days/${dateIn(timezone, -1)}`);
      check('вчерашняя дата отклонена', 400, r.status);

      r = await asBooker(
        `/clubs/yenisey/booking/quote?hallId=${bookingHall.id}&durationMinutes=60&withRobot=false`,
      );
      check('цена часа посчитана', 200, r.status);
      assert(
        `час стоит цену часа (${r.body?.price} против ${bookingHall.tableHourPrice})`,
        r.body?.price === bookingHall.tableHourPrice,
      );

      r = await asBooker(
        `/clubs/yenisey/booking/quote?hallId=${bookingHall.id}&durationMinutes=80&withRobot=false`,
      );
      check('цена неполного получаса посчитана', 200, r.status);
      assert(
        '80 минут оплачиваются как 90: начатые полчаса считаются полными',
        r.body?.billedMinutes === 90,
      );
      assert(
        'и стоят как час с доплатой',
        r.body?.price === bookingHall.tableHourPrice + bookingHall.tableExtra30MinPrice,
      );

      // Свободный час ищется по самой сетке, а не угадывается: расписание
      // клуба на завтра заранее неизвестно.
      const step = bookingDay.stepMinutes;
      let freeTable = null;
      let freeMinute = null;

      for (const table of bookingDay.tables ?? []) {
        for (let minute = bookingDay.earliestMinute; minute + 60 <= 1440; minute += step) {
          if (minute % step !== 0) continue;

          const busy = table.busy.some(
            (slot) => minute < slot.endMinute && slot.startMinute < minute + 60,
          );

          if (!busy) {
            freeTable = table;
            freeMinute = minute;
            break;
          }
        }

        if (freeTable) break;
      }

      if (!freeTable) {
        console.log('     свободного часа завтра нет — проверки самой брони пропущены');
      } else {
        const startsAt = instantAt(bookDate, freeMinute, timezone);

        if (step !== 45 && 45 % step !== 0) {
          r = await asBooker('/clubs/yenisey/booking/bookings', {
            method: 'POST',
            json: { tableId: freeTable.tableId, startsAt, durationMinutes: 45, withRobot: false },
          });
          check('длительность не по шагу зала отклонена', 400, r.status);
        }

        r = await asBooker('/clubs/yenisey/booking/bookings', {
          method: 'POST',
          json: {
            tableId: freeTable.tableId,
            startsAt: instantAt(bookDate, freeMinute + 7, timezone),
            durationMinutes: 60,
            withRobot: false,
          },
        });
        check('начало не по шагу зала отклонено', 400, r.status);

        r = await asBooker('/clubs/yenisey/booking/bookings', {
          method: 'POST',
          json: { tableId: freeTable.tableId, startsAt, durationMinutes: 60, withRobot: false },
        });
        check('стол забронирован', 201, r.status);
        const bookingId = r.body?.id;
        assert('цена зафиксирована копией', r.body?.price === bookingHall.tableHourPrice);
        assert('бронь активна', r.body?.status === 'BOOKED');
        assert(
          'видно, сколько спишется при отмене сейчас',
          typeof r.body?.cancelChargePercentNow === 'number',
        );

        r = await asBooker('/clubs/yenisey/booking/bookings', {
          method: 'POST',
          json: { tableId: freeTable.tableId, startsAt, durationMinutes: 60, withRobot: false },
        });
        check('повторная бронь того же времени отклонена', 400, r.status);

        r = await asBooker(`/clubs/yenisey/booking/halls/${bookingHall.id}/days/${bookDate}`);
        const reread = r.body?.tables?.find((item) => item.tableId === freeTable.tableId);
        assert(
          'бронь появилась в сетке занятого времени',
          (reread?.busy ?? []).some((slot) => slot.startMinute === freeMinute),
        );

        r = await asBooker('/clubs/yenisey/booking/bookings');
        check('список своих броней прочитан', 200, r.status);
        assert(
          'бронь в списке',
          (r.body ?? []).some((item) => item.id === bookingId),
        );

        r = await asAdmin('/clubs/yenisey/booking/bookings', {
          method: 'POST',
          json: { tableId: freeTable.tableId, startsAt, durationMinutes: 60, withRobot: false },
        });
        check('администратору этот маршрут закрыт: у него нет карточки клиента', 403, r.status);

        r = await asBooker(`/clubs/yenisey/booking/bookings/${bookingId}`, { method: 'DELETE' });
        check('бронь отменена', 200, r.status);
        assert('статус сменился', r.body?.status === 'CANCELLED');
        assert('процент списания зафиксирован', Number.isInteger(r.body?.chargePercent));
        assert('отменять больше нечего', r.body?.cancelChargePercentNow === null);

        r = await asBooker(`/clubs/yenisey/booking/bookings/${bookingId}`, { method: 'DELETE' });
        check('повторная отмена отклонена', 400, r.status);

        r = await asBooker(`/clubs/yenisey/booking/halls/${bookingHall.id}/days/${bookDate}`);
        const afterCancel = r.body?.tables?.find((item) => item.tableId === freeTable.tableId);
        assert(
          'отменённая бронь время больше не занимает',
          !(afterCancel?.busy ?? []).some((slot) => slot.startMinute === freeMinute),
        );

        console.log('=== 25. Единый аккаунт: запись без вступления в клуб');
        // Самое рискованное место новой модели: человек регистрируется НА
        // ПЛАТФОРМЕ, ни в каком клубе не состоит — и всё равно бронирует стол.
        // Привязка обязана завестись сама: бронь ссылается на ClientProfile, а тот —
        // на TenantMembership, и без неё запрос упал бы ошибкой внешнего ключа.
        const outsider = registration({ tenantSlug: undefined });
        r = await post('/auth/register', outsider);
        check('регистрация без клуба принята', 201, r.status);
        assert(
          'человек ни в одном клубе не состоит',
          Array.isArray(r.body?.user?.memberships) && r.body.user.memberships.length === 0,
        );

        const outsiderAuth = { Authorization: `Bearer ${r.body?.accessToken ?? ''}` };
        const asOutsider = (path, options = {}) =>
          call(path, { ...options, headers: { ...outsiderAuth, ...(options.headers ?? {}) } });

        r = await asOutsider('/clubs/yenisey/settings');
        check('чужому человеку настройки клуба закрыты', 403, r.status);

        r = await asOutsider('/clubs/net-takogo-kluba/booking/halls');
        check('несуществующий клуб в адресе — 404, а не пустой ответ', 404, r.status);

        r = await asOutsider('/clubs/yenisey/booking/bookings', {
          method: 'POST',
          json: { tableId: freeTable.tableId, startsAt, durationMinutes: 60, withRobot: false },
        });
        check('записаться может любой пользователь платформы', 201, r.status);
        const outsiderBooking = r.body?.id;

        r = await asOutsider('/auth/me');
        assert(
          'привязка к клубу завелась первой же бронью',
          (r.body?.memberships ?? []).some((m) => m.slug === 'yenisey' && m.role === 'CLIENT'),
        );

        r = await asOutsider(`/clubs/yenisey/booking/bookings/${outsiderBooking}`, {
          method: 'DELETE',
        });
        check('свою бронь он же и отменяет', 200, r.status);
      }
    }

    console.log('=== 22р. Рабочее место администратора');
    const deskPath = `/clubs/yenisey/desk/halls/${hallId}/days/${cupDate}`;

    r = await call(deskPath);
    check('смена без токена закрыта', 401, r.status);

    r = await call(deskPath, { headers: { Authorization: `Bearer ${access}` } });
    check('смена клиенту закрыта', 403, r.status);

    r = await asAdmin(`/clubs/yenisey/desk/halls/net-takogo-zala/days/${cupDate}`);
    check('несуществующий зал', 404, r.status);

    r = await asAdmin(`/clubs/yenisey/desk/halls/${hallId}/days/03-10-2026`);
    check('дата задом наперёд отклонена', 400, r.status);

    r = await asAdmin(deskPath);
    check('смена открыта администратору', 200, r.status);

    const desk = r.body;
    assert('смена про запрошенный зал', desk?.hallId === hallId);

    // Дата проверки — будущая, и «сейчас» у неё быть не может: текущего
    // момента у чужого дня не существует, и рисовать на нём занятость
    // «прямо сейчас» значило бы соврать.
    assert('будущий день не считается сегодняшним', desk?.today === false);
    assert('у несегодняшнего дня нет текущей минуты', desk?.nowMinute === null);
    // Стол в этом зале ровно один: twinId выше заводится в ГЛАВНОМ зале
    // клуба, а не в тестовом.
    assert('столы зала на месте', Array.isArray(desk?.tables) && desk.tables.length === 1);

    // Сетка идёт с 06:00 до полуночи — те же границы, что у брони.
    assert('график покрывает сутки работы', desk?.load?.length === 18);
    assert('границы сетки те же, что у брони', desk?.openMinute === 360 && desk?.closeMinute === 1440);

    // Турнир стоит в сетке этого дня, и рабочее место обязано его показать.
    // Берётся он именно из окон расписания: у турнира и занятия нет зала,
    // связывает их с ним только сетка.
    const deskCup = (desk?.events ?? []).find((item) => item.id === tournamentId);
    assert('турнир из сетки виден в смене', deskCup?.kind === 'TOURNAMENT');
    assert('у турнира нет лимита мест', deskCup?.capacity === null);
    assert('у турнира нет тренера', deskCup?.coachName === null);
    assert('у турнира в смене есть окончание', typeof deskCup?.endsAt === 'string');

    // Окно турнира занимает стол с 10:00: у несегодняшнего дня это и есть
    // ответ на вопрос «с какого часа зал занят».
    const deskTable = (desk?.tables ?? []).find((item) => item.tableId === tableId);
    assert('стол под турниром занят с 10:00', deskTable?.nextFromMinute === 600);
    assert('состояние «сейчас» у чужого дня пустое', deskTable?.busy === null);

    const tenth = (desk?.load ?? []).find((item) => item.hour === 10);
    const ninth = (desk?.load ?? []).find((item) => item.hour === 9);
    assert('в десятом часу занят один стол', tenth?.busyTables === 1);
    assert('в девятом часу свободно', ninth?.busyTables === 0);

    assert(
      'деньги разложены по видам услуг',
      desk?.money !== undefined &&
        Number.isInteger(desk.money.tables) &&
        Number.isInteger(desk.money.trainings) &&
        Number.isInteger(desk.money.tournaments) &&
        desk.money.total === desk.money.tables + desk.money.trainings + desk.money.tournaments,
    );

    console.log('=== 22б. Бронь администратором');

    // Отдельные зал и стол под брони, а не те, что выше.
    //
    // Причина в правиле продукта: бронь не удаляется никогда — это история
    // платежей, — и стол, за которым хоть раз кого-то посадили, удалить уже
    // нельзя. Пусти брони на общий тестовый стол, и уборка ниже перестала бы
    // проходить; пусти на twinId — а он живёт в НАСТОЯЩЕМ главном зале клуба —
    // и смоук оставил бы неудаляемый стол в рабочих данных.
    //
    // Этот зал уборка не трогает: его вместе с бронями снимает
    // `pnpm db:clean-probes`, как и учётки probe-*.
    r = await asAdmin('/clubs/yenisey/halls', {
      method: 'POST',
      json: {
        name: `Зал проверки ${RUN} (брони)`,
        timezone: 'Asia/Krasnoyarsk',
        cityId: null,
        address: null,
        bookingStep: 'MIN_30',
        tableHourPrice: 30000,
        tableExtra30MinPrice: 15000,
        hasRobotOption: false,
        robot30MinPrice: null,
        robot60MinPrice: null,
        robotExtra30MinPrice: null,
      },
    });
    check('зал под брони заведён', 201, r.status);
    const seatHallId = r.body?.id;

    r = await asAdmin('/clubs/yenisey/tables', {
      method: 'POST',
      json: { hallId: seatHallId, label: `Стол проверки ${RUN} (брони)` },
    });
    check('стол под брони заведён', 201, r.status);
    const seatTableId = r.body?.id;

    // Клиента заводим отдельного, и он ещё НЕ состоит в клубе — это часть
    // проверки: привязка обязана завестись первой же бронью.
    r = await post('/auth/register', registration({ tenantSlug: undefined }));
    check('новичок платформы заведён', 201, r.status);
    const seatedId = r.body?.user?.id ?? '';
    const seatedAuth = { Authorization: `Bearer ${r.body?.accessToken ?? ''}` };
    const asSeated = (path, options = {}) =>
      call(path, { ...options, headers: { ...seatedAuth, ...(options.headers ?? {}) } });
    assert('в клубах он не состоит', r.body?.user?.memberships?.length === 0);

    const deskBookings = '/clubs/yenisey/desk/bookings';
    const seatDate = dateIn('Asia/Krasnoyarsk', 3);
    const seatAt = instantAt(seatDate, 14 * 60, 'Asia/Krasnoyarsk');

    r = await call(deskBookings, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}` },
      json: { clientId: seatedId, tableId: seatTableId, startsAt: seatAt, durationMinutes: 60, withRobot: false },
    });
    check('посадка клиенту закрыта', 403, r.status);

    r = await asAdmin(deskBookings, {
      method: 'POST',
      json: { clientId: seatedId, tableId: seatTableId, startsAt: seatAt, durationMinutes: 60, withRobot: false },
    });
    check('администратор посадил клиента', 201, r.status);

    const seatId = r.body?.id ?? '';
    const seatPrice = r.body?.price;
    assert('бронь помечена как ручная', r.body?.manual === true);
    assert(
      'у брони записан автор',
      typeof r.body?.createdBy === 'string' && r.body.createdBy.length > 0,
    );
    assert('в броне виден телефон клиента', typeof r.body?.client?.phone === 'string');

    // Привязка к клубу заводится первой же бронью — тем же кодом, что и при
    // самостоятельной записи.
    r = await asAdmin(`${deskBookings}?clientId=${seatedId}`);
    check('список броней клуба читается', 200, r.status);
    assert('бронь новичка в списке', Array.isArray(r.body) && r.body.length === 1);

    // Цену считает только сервер. Сверяем с тем же расчётом, которым
    // пользуется клиентская форма: разойтись им нельзя.
    r = await asAdmin(
      `/clubs/yenisey/booking/quote?hallId=${seatHallId}&durationMinutes=60&withRobot=false`,
    );
    check('расчёт цены открыт администратору', 200, r.status);
    assert(
      'цена брони равна расчёту сервера',
      typeof seatPrice === 'number' && seatPrice > 0 && r.body?.price === seatPrice,
    );

    // Чужая бронь непреодолима: два человека за одним столом не помещаются
    // физически, и это держит exclusion-констрейнт.
    r = await asAdmin(deskBookings, {
      method: 'POST',
      json: { clientId: seatedId, tableId: seatTableId, startsAt: seatAt, durationMinutes: 60, withRobot: false },
    });
    // 400, а не 409: занятость видна проверке в сервисе, и она отвечает
    // внятной строкой. 409 от exclusion-констрейнта остаётся на гонку —
    // два одновременных запроса, которые оба увидели стол свободным.
    // Тот же порядок, что у клиентской брони.
    check('бронь поверх чужой брони отклонена', 400, r.status);
    assert(
      'отказ объясняет причину',
      String(r.body?.message ?? '').includes('занят'),
    );

    r = await asAdmin(deskBookings, {
      method: 'POST',
      json: { clientId: seatedId, tableId: seatTableId, startsAt: seatAt, durationMinutes: 37, withRobot: false },
    });
    check('длительность не по шагу зала отклонена', 400, r.status);

    r = await asAdmin(deskBookings, {
      method: 'POST',
      json: {
        clientId: seatedId,
        tableId: seatTableId,
        startsAt: instantAt(seatDate, 3 * 60, 'Asia/Krasnoyarsk'),
        durationMinutes: 60,
        withRobot: false,
      },
    });
    check('бронь вне часов работы отклонена', 400, r.status);

    r = await asAdmin(deskBookings, {
      method: 'POST',
      json: { clientId: seatedId, tableId: seatTableId, startsAt: seatAt, durationMinutes: 60, withRobot: true },
    });
    check('робот в зале без робота отклонён', 400, r.status);

    // Перенос, а не «отменить и создать»: отмена зафиксировала бы процент
    // списания и испортила клиенту статистику отмен.
    r = await asAdmin(`${deskBookings}/${seatId}`, {
      method: 'PATCH',
      json: {
        tableId: seatTableId,
        startsAt: instantAt(seatDate, 16 * 60, 'Asia/Krasnoyarsk'),
        durationMinutes: 90,
      },
    });
    check('бронь перенесена', 200, r.status);
    assert('статус остался активным', r.body?.status === 'BOOKED');
    assert('цена пересчитана под новую длительность', r.body?.price !== seatPrice);

    r = await asAdmin(`${deskBookings}/${seatId}/cancel`, {
      method: 'POST',
      json: { waiveCharge: true },
    });
    check('бронь отменена без списания', 201, r.status);
    assert('списание прощено', r.body?.chargePercent === 0);
    assert('момент отмены записан', typeof r.body?.cancelledAt === 'string');

    r = await asAdmin(`${deskBookings}/${seatId}/cancel`, { method: 'POST', json: {} });
    check('повторная отмена отклонена', 400, r.status);

    console.log('=== 22в. Отметка присутствия: аренда');
    const attendance = '/clubs/yenisey/desk/attendance';
    const seatZone = 'Asia/Krasnoyarsk';
    const yesterday = dateIn(seatZone, -1);
    const seat = (startsAt, durationMinutes = 60) =>
      asAdmin(deskBookings, {
        method: 'POST',
        json: { clientId: seatedId, tableId: seatTableId, startsAt, durationMinutes, withRobot: false },
      });

    r = await seat(seatAt);
    check('будущая бронь заведена', 201, r.status);
    const futureId = r.body?.id ?? '';
    assert('будущая бронь ждёт своего часа', r.body?.status === 'BOOKED' && r.body?.phase === 'UPCOMING');

    r = await asAdmin(`${attendance}/table/${futureId}`, { method: 'PUT', json: { status: 'ATTENDED' } });
    check('отметить бронь до начала нельзя', 400, r.status);

    r = await call(`${attendance}/table/${futureId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${access}` },
      json: { status: 'ATTENDED' },
    });
    check('клиенту отметка закрыта', 403, r.status);

    r = await asAdmin(`${attendance}/sparring/${futureId}`, { method: 'PUT', json: { status: 'ATTENDED' } });
    check('неизвестный вид записи', 404, r.status);

    r = await asAdmin(`${attendance}/table/net-takoi-broni`, { method: 'PUT', json: { status: 'ATTENDED' } });
    check('несуществующая бронь', 404, r.status);

    r = await asAdmin(`${attendance}/table/${futureId}`, { method: 'PUT', json: { status: 'MAYBE' } });
    check('неизвестная отметка отклонена', 400, r.status);

    // Бронь задним числом — сразу «пришёл», в той же транзакции. Иначе через
    // сутки её закрыла бы неявкой джоба — со списанием за состоявшуюся игру.
    // Вечер вчерашнего дня: кончается меньше суток назад, и включённая джоба
    // автонеявки не закроет эти брони посреди проверки.
    r = await seat(instantAt(yesterday, 21 * 60, seatZone));
    check('бронь задним числом заведена', 201, r.status);
    const retroId = r.body?.id ?? '';
    assert(
      'бронь задним числом сразу «пришёл»',
      r.body?.status === 'ATTENDED' && r.body?.chargePercent === 100,
    );
    assert(
      'у отметки есть подпись администратора',
      typeof r.body?.mark?.by === 'string' && r.body?.mark?.auto === false,
    );

    // Неотмеченная начавшаяся бронь: перенос во вчера статус не трогает —
    // перенос правит время, а не факт прихода.
    r = await seat(instantAt(seatDate, 18 * 60, seatZone));
    const missedId = r.body?.id ?? '';
    r = await asAdmin(`${deskBookings}/${missedId}`, {
      method: 'PATCH',
      json: { tableId: seatTableId, startsAt: instantAt(yesterday, 23 * 60, seatZone), durationMinutes: 60 },
    });
    check('бронь перенесена во вчера', 200, r.status);
    // Просрочена или только ждёт — зависит от часа прогона: в первый час
    // суток вчерашняя бронь до 24:00 кончилась меньше часа назад.
    assert(
      'перенесённая во вчера закончилась и ждёт отметки',
      r.body?.status === 'BOOKED' && ['AWAITING', 'OVERDUE'].includes(r.body?.phase),
    );

    // Процент неявки — из смены: сценарий настроек выше мог его поменять.
    const yesterdayDesk = `/clubs/yenisey/desk/halls/${seatHallId}/days/${yesterday}`;
    r = await asAdmin(yesterdayDesk);
    check('вчерашний день зала открыт', 200, r.status);
    const noShowPercent = r.body?.policy?.noShowChargePercent;
    assert('политика присутствия приехала со сменой', Number.isInteger(noShowPercent));
    const pendingIds = (r.body?.pending?.bookings ?? []).map((item) => item.id);
    assert('неотмеченная бронь — в «Требует отметки»', pendingIds.includes(missedId));
    assert('отмеченная — нет', !pendingIds.includes(retroId));

    // После начала запись не отменяется, а отмечается — и клиентом, и
    // администратором. Иначе пропустивший отменял бы задним числом и платил
    // позднюю отмену вместо неявки.
    r = await asSeated(`/clubs/yenisey/booking/bookings/${missedId}`, { method: 'DELETE' });
    check('клиент не отменяет начавшуюся бронь', 400, r.status);
    assert('отказ объясняет, что бронь уже началась', String(r.body?.message ?? '').includes('началась'));

    r = await asAdmin(`${deskBookings}/${missedId}/cancel`, { method: 'POST', json: { waiveCharge: true } });
    check('администратор не отменяет начавшуюся бронь', 400, r.status);
    assert('отказ отправляет к отметке', String(r.body?.message ?? '').includes('отметьте'));

    r = await asSeated('/me/bookings');
    const missedEntry = (r.body ?? []).find((entry) => entry.entryId === missedId);
    assert('в «Моих записях» начавшаяся бронь не отменяемая', missedEntry?.cancellable === false);
    assert('и спрашивать, сколько спишет отмена, не с чего', missedEntry?.cancelChargePercentNow === null);

    const markMissed = (json) =>
      asAdmin(`${attendance}/table/${missedId}`, { method: 'PUT', json });

    r = await markMissed({ status: 'NO_SHOW' });
    check('неявка отмечена', 200, r.status);
    assert(
      'неявка — по проценту клуба',
      r.body?.status === 'NO_SHOW' && r.body?.chargePercent === noShowPercent && r.body?.changed === true,
    );

    r = await markMissed({ status: 'NO_SHOW' });
    check('повтор неявки не ошибка', 200, r.status);
    assert('повтор ничего не меняет', r.body?.changed === false);

    r = await markMissed({ status: 'ATTENDED' });
    check('исправление без причины отклонено', 400, r.status);
    assert('отказ просит причину', String(r.body?.message ?? '').includes('причин'));

    r = await markMissed({ status: 'NO_SHOW', waiveCharge: true, reason: '   ' });
    check('прощение без причины отклонено', 400, r.status);

    r = await markMissed({ status: 'ATTENDED', waiveCharge: true, reason: 'клуб виноват' });
    check('простить можно только неявку', 400, r.status);

    r = await markMissed({ status: 'NO_SHOW', waiveCharge: true, reason: 'Стол сломался' });
    check('неявка прощена', 200, r.status);
    assert('прощённая неявка — без списания', r.body?.chargePercent === 0 && r.body?.changed === true);

    // Неявка освобождает стол, и время заняли. Вернуть «пришёл» — снова занять
    // его, а два человека за одним столом не помещаются.
    r = await seat(instantAt(yesterday, 23 * 60, seatZone));
    check('на освободившееся время посадили другого', 201, r.status);

    r = await markMissed({ status: 'ATTENDED', reason: 'Пришёл к концу' });
    check('«пришёл» на занятое время отклонён', 409, r.status);

    r = await asAdmin(`${attendance}/table/${missedId}/history`);
    check('история отметок читается', 200, r.status);
    const history = Array.isArray(r.body) ? r.body : [];
    assert('в истории обе отметки, без повтора', history.length === 2);
    assert('первая — неявка от человека', history[0]?.after?.status === 'NO_SHOW' && history[0]?.auto === false);
    assert(
      'вторая — прощение с причиной и процентом до и после',
      history[1]?.reason === 'Стол сломался' &&
        history[1]?.before?.chargePercent === noShowPercent &&
        history[1]?.after?.chargePercent === 0,
    );

    r = await call(`${attendance}/table/${missedId}/history`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    check('клиенту история закрыта', 403, r.status);

    r = await asAdmin(yesterdayDesk);
    const missed = (r.body?.bookings ?? []).find((item) => item.id === missedId);
    assert('в смене видно, кто и почему поставил отметку', missed?.mark?.reason === 'Стол сломался');
    assert('отмеченное ушло из «Требует отметки»', !(r.body?.pending?.bookings ?? []).some((item) => item.id === missedId));

    console.log('=== 22г. Визит с порога');
    const visits = '/clubs/yenisey/desk/visits';
    const visitAt = instantAt(yesterday, 15 * 60, seatZone);

    r = await call(visits, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}` },
      json: { clientId: seatedId, visitedAt: visitAt },
    });
    check('клиенту визит с порога закрыт', 403, r.status);

    r = await asAdmin(visits, {
      method: 'POST',
      json: { clientId: seatedId, visitedAt: new Date(Date.now() + 86_400_000).toISOString() },
    });
    check('визит в будущем отклонён', 400, r.status);

    r = await asAdmin(visits, { method: 'POST', json: { clientId: 'net-takogo', visitedAt: visitAt } });
    check('визит несуществующего человека', 404, r.status);

    r = await asAdmin(visits, {
      method: 'POST',
      json: { clientId: seatedId, visitedAt: visitAt, coachId: seatedId },
    });
    check('тренер не из клуба отклонён', 400, r.status);

    r = await asAdmin(visits, {
      method: 'POST',
      json: { clientId: seatedId, visitedAt: visitAt, note: 'Пришёл с другом' },
    });
    check('визит с порога внесён', 201, r.status);
    const visitId = r.body?.id;
    assert('комментарий сохранён', r.body?.note === 'Пришёл с другом');
    assert('у визита есть автор', typeof r.body?.recordedBy === 'string');

    r = await asAdmin(visits, { method: 'POST', json: { clientId: seatedId, visitedAt: visitAt } });
    check('двойное нажатие — не второй визит', 409, r.status);

    r = await asAdmin(yesterdayDesk);
    assert('визит виден в смене своего дня', (r.body?.visits ?? []).some((item) => item.id === visitId));

    // Стол с бронями удалить нельзя — даже отменёнными: за бронями стоит
    // история платежей. Зал с таким столом, соответственно, тоже.
    r = await asAdmin(`/clubs/yenisey/tables/${seatTableId}`, { method: 'DELETE' });
    check('стол с бронями удалить нельзя', 409, r.status);

    console.log('=== 23. Уборка проверочных данных');
    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/days/${cupDate}`, { method: 'DELETE' });
    check('день с турниром возвращён к шаблону', 200, r.status);
    // Отдельного удаления турнира больше не нужно: он стоял только в этом дне и
    // записей не имел — ушёл вместе с днём.
    r = await asAdmin('/clubs/yenisey/tournaments');
    assert('турнир ушёл вместе с днём', !(r.body ?? []).some((item) => item.id === tournamentId));
    r = await asAdmin(`/clubs/yenisey/tournament-types/${tournamentTypeId}`, { method: 'DELETE' });
    check('тип турнира убран', 204, r.status);
    await asAdmin(`/clubs/yenisey/halls/${hallId}/template`, { method: 'PUT', json: { rules: [] } });
    r = await asAdmin(`/clubs/yenisey/training-types/${trainingTypeId}`, { method: 'DELETE' });
    check('тип тренировки убран', 204, r.status);
    r = await asAdmin(`/clubs/yenisey/tables/${tableId}`, { method: 'DELETE' });
    check('стол проверки убран', 204, r.status);
    r = await asAdmin(`/clubs/yenisey/tables/${twinId}`, { method: 'DELETE' });
    check('стол-двойник убран', 204, r.status);
    r = await asAdmin(`/clubs/yenisey/halls/${hallId}`, { method: 'DELETE' });
    check('пустой зал удалён', 204, r.status);

    r = await patchSettings(originalSettings);
    check('настройки клуба возвращены в исходное состояние', 200, r.status);
    assert(
      'вернулось всё, а не часть',
      JSON.stringify(r.body) === JSON.stringify(originalSettings),
    );
  }


  console.log('=== 26. Платформенный слой: поиск клубов, мои клубы, мероприятия');

  // Справочник городов открыт без входа: он нужен стартовой странице, куда
  // человек попадает до всякой регистрации.
  r = await call('/cities');
  check('справочник городов открыт без входа', 200, r.status);
  const cities = Array.isArray(r.body) ? r.body : [];
  assert('в справочнике есть города', cities.length > 0);

  const minusinsk = cities.find((city) => city.name === 'Минусинск');
  const krasnoyarsk = cities.find((city) => city.name === 'Красноярск');

  r = await call('/clubs');
  check('поиск клубов без условий открыт без входа', 200, r.status);
  assert('пустой запрос отдаёт все клубы, а не пустоту', (r.body?.length ?? 0) > 0);

  if (krasnoyarsk) {
    r = await call(`/clubs?cityId=${krasnoyarsk.id}`);
    assert(
      '«Енисей» находится по своему городу',
      (r.body ?? []).some((club) => club.slug === 'yenisey'),
    );
  }

  if (minusinsk) {
    // ГЛАВНОЕ правило поиска: клуб находится по городу ЗАЛА, а не только по
    // своему. Иначе клуб с залами в разных регионах нашёлся бы лишь по одному
    // из них, и перенос пояса в зал потерял бы смысл.
    r = await call(`/clubs?cityId=${minusinsk.id}`);
    const found = r.body ?? [];
    assert(
      'клуб находится по городу ЗАЛА, а не только по городу клуба',
      found.some((club) => club.slug === 'sayany' && club.city !== 'Минусинск'),
    );
  }

  r = await call('/clubs?query=%D0%B5%D0%BD%D0%B8%D1%81');
  assert(
    'поиск по обрывку названия в нижнем регистре находит «АНТ «Енисей»»',
    (r.body ?? []).some((club) => club.slug === 'yenisey'),
  );

  // Дальше — от имени свежего человека без единой привязки к клубу.
  // tenantSlug снят намеренно: аккаунт заводится НА ПЛАТФОРМЕ, и вступать
  // куда-либо, чтобы им пользоваться, не нужно.
  r = await post('/auth/register', registration({ tenantSlug: undefined }));
  check('человек платформы заведён без клуба', 201, r.status);
  assert('привязок к клубам у него нет', r.body?.user?.memberships?.length === 0);

  const mineAuth = { Authorization: `Bearer ${r.body?.accessToken ?? ''}` };
  const asMe = (path, options = {}) =>
    call(path, { ...options, headers: { ...mineAuth, ...(options.headers ?? {}) } });

  r = await asMe('/me/clubs');
  check('мои клубы читаются', 200, r.status);
  assert('своих клубов у новичка нет', r.body?.length === 0);

  r = await asMe('/me/clubs/yenisey', { method: 'PUT' });
  check('клуб отмечен своим', 200, r.status);
  assert('занято первое место', r.body?.[0]?.slot === 1);

  r = await asMe('/me/clubs/yenisey', { method: 'PUT' });
  assert('повторная отметка не заводит дубль', r.body?.length === 1);

  r = await asMe('/me/clubs/sayany', { method: 'PUT' });
  assert('второй клуб занял второе место', r.body?.length === 2 && r.body?.[1]?.slot === 2);

  r = await asMe('/me/clubs/net-takogo-kluba', { method: 'PUT' });
  check('несуществующий клуб отмечать нечем', 404, r.status);

  r = await asMe('/me/clubs/sayany', { method: 'DELETE' });
  assert('отметка снимается', r.body?.length === 1);

  // Открытый список мероприятий клуба: виден без входа, но вошедшему говорит
  // больше — записан ли он сам.
  r = await call('/clubs/yenisey/events');
  check('мероприятия клуба открыты без входа', 200, r.status);
  const anonymous = r.body ?? [];
  assert(
    'анониму не сообщается, записан ли он',
    anonymous.every((event) => event.registered === null),
  );

  r = await asMe('/clubs/yenisey/events');
  assert(
    'вошедшему сообщается, записан ли он',
    (r.body ?? []).every((event) => typeof event.registered === 'boolean'),
  );

  r = await asMe('/me/bookings');
  check('«Мои записи» читаются', 200, r.status);
  assert('записей у новичка нет', r.body?.length === 0);

  await eventRegistration(asMe);
  await eventAttendance(asMe);
  await autoNoShow(asMe);

  console.log(`\nИТОГО: успешно ${passed}, провалов ${failed}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

/**
 * Запись на мероприятия: занятие и турнир.
 *
 * Раньше проверялись только списки — сама запись не была покрыта вовсе, хотя
 * это единственное действие, ради которого клиент вообще приходит на страницу
 * клуба. Здесь она и проверяется: запись, дубль, отмена, начавшееся
 * мероприятие и переполнение группы.
 *
 * Мероприятия заводятся прямо здесь и здесь же убираются: сид их не заводит
 * (это данные клуба, а не настройка), а демо-набор на машине может
 * отсутствовать.
 */
async function eventRegistration(asMe) {
  const adminEmail = process.env.SMOKE_ADMIN_EMAIL;
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.log('\n=== 27. Запись на мероприятия — ПРОПУЩЕНА (нет учётки администратора)');
    return;
  }

  console.log('\n=== 27. Запись на занятие и турнир');

  let r = await post('/auth/login', { email: adminEmail, password: adminPassword });
  const adminAuth = { Authorization: `Bearer ${r.body?.accessToken ?? ''}` };
  const asAdmin = (path, options = {}) =>
    call(path, { ...options, headers: { ...adminAuth, ...(options.headers ?? {}) } });

  // Тренер нужен любой: занятие без тренера не заводится вовсе.
  r = await asAdmin('/clubs/yenisey/coaches');
  const coachId = r.body?.[0]?.id;

  if (!coachId) {
    console.log('     тренеров в клубе нет — сценарий пропущен (заведите тренера)');
    return;
  }

  r = await asAdmin('/clubs/yenisey/training-types');
  const trainingTypeId = r.body?.[0]?.id;

  r = await asAdmin('/clubs/yenisey/tournament-types');
  const tournamentTypeId = r.body?.[0]?.id;

  const soon = new Date(Date.now() + 7 * 24 * 3600_000);
  const later = new Date(soon.getTime() + 90 * 60_000);

  // Вместимость 1: ровно на ней и проверяется переполнение группы. Лимит мест
  // констрейнтом не выражается, его держит блокировка строки в сервисе, и без
  // этого сценария поломка блокировки прошла бы незамеченной.
  r = await asAdmin('/clubs/yenisey/training-sessions', {
    method: 'POST',
    json: {
      trainingTypeId,
      coachId,
      startsAt: soon.toISOString(),
      endsAt: later.toISOString(),
      capacity: 1,
    },
  });
  check('занятие заведено', 201, r.status);
  const sessionId = r.body?.id;
  assert('тренер приехал вместе с занятием', typeof r.body?.coachName === 'string');
  assert('мест занято ноль', r.body?.bookedCount === 0);

  r = await asAdmin('/clubs/yenisey/training-sessions', {
    method: 'POST',
    json: {
      trainingTypeId,
      coachId,
      startsAt: later.toISOString(),
      endsAt: soon.toISOString(),
      capacity: 4,
    },
  });
  check('занятие, кончающееся раньше начала, отклонено', 400, r.status);

  r = await asAdmin('/clubs/yenisey/tournaments', {
    method: 'POST',
    json: { tournamentTypeId, startsAt: soon.toISOString(), endsAt: later.toISOString() },
  });
  check('турнир заведён', 201, r.status);
  const tournamentId = r.body?.id;

  // --- Открытый список отдаёт оба вида и различает их.
  r = await call('/clubs/yenisey/events');
  const events = r.body ?? [];
  const session = events.find((event) => event.id === sessionId);
  assert('занятие попало в открытый список', session?.kind === 'TRAINING');
  assert('у занятия известно окончание', typeof session?.endsAt === 'string');
  assert('у занятия видны свободные места', session?.freeSeats === 1 && session?.capacity === 1);
  assert(
    'у турнира лимита мест нет',
    events.find((event) => event.id === tournamentId)?.freeSeats === null,
  );

  // --- Запись клиента.
  r = await asMe(`/clubs/yenisey/trainings/${sessionId}/booking`, { method: 'POST' });
  check('запись на занятие', 201, r.status);
  assert('запись вернулась строкой списка', r.body?.kind === 'TRAINING');
  assert('идентификатор — занятия, а не строки записи', r.body?.id === sessionId);

  r = await asMe(`/clubs/yenisey/trainings/${sessionId}/booking`, { method: 'POST' });
  check('повторная запись на занятие отклонена', 409, r.status);

  r = await asMe(`/clubs/yenisey/tournaments/${tournamentId}/registration`, { method: 'POST' });
  check('запись на турнир', 201, r.status);

  r = await asMe('/clubs/yenisey/events');
  const mine = (r.body ?? []).find((event) => event.id === sessionId);
  assert('вошедший видит себя записанным', mine?.registered === true);
  assert('состав записавшихся отдаётся сокращённым', /^\S+ \S\.$/.test(mine?.participants?.[0] ?? ''));
  assert('мест не осталось', mine?.freeSeats === 0);

  r = await asMe('/me/bookings');
  const kinds = (r.body ?? []).map((entry) => entry.kind);
  assert('обе записи видны в «Моих записях»', kinds.includes('TRAINING') && kinds.includes('TOURNAMENT'));

  // --- Переполнение группы: второй клиент в группу на одного не помещается.
  r = await post('/auth/register', registration({ tenantSlug: undefined }));
  const otherAuth = { Authorization: `Bearer ${r.body?.accessToken ?? ''}` };
  const asOther = (path, options = {}) =>
    call(path, { ...options, headers: { ...otherAuth, ...(options.headers ?? {}) } });

  r = await asOther(`/clubs/yenisey/trainings/${sessionId}/booking`, { method: 'POST' });
  check('в переполненную группу записаться нельзя', 409, r.status);

  // --- Отмена. Занятие через неделю — по политике «Енисея» списывается 0%.
  r = await asMe(`/clubs/yenisey/trainings/${sessionId}/booking`, { method: 'DELETE' });
  check('отмена записи на занятие', 200, r.status);
  assert('запись отменена', r.body?.status === 'CANCELLED');
  assert('заранее — без списания', r.body?.chargePercent === 0);

  r = await asMe(`/clubs/yenisey/trainings/${sessionId}/booking`, { method: 'DELETE' });
  check('повторная отмена не находит записи', 404, r.status);

  r = await asOther(`/clubs/yenisey/trainings/${sessionId}/booking`, { method: 'POST' });
  check('освободившееся место достаётся другому', 201, r.status);

  r = await asMe(`/clubs/yenisey/tournaments/${tournamentId}/registration`, { method: 'DELETE' });
  check('отмена записи на турнир', 200, r.status);
  const firstEntry = r.body?.entryId;
  assert('до начала запись отменяемая, после отмены — нет', r.body?.cancellable === false);

  // Отменил и записался снова: у турнира две строки одного человека. Раньше
  // отмена находила старую отменённую и отвечала «уже нельзя отменить».
  r = await asMe(`/clubs/yenisey/tournaments/${tournamentId}/registration`, { method: 'POST' });
  check('повторная запись на турнир после отмены', 201, r.status);
  const secondEntry = r.body?.entryId;
  assert('ответ — новая запись, а не старая отменённая', r.body?.status === 'BOOKED' && secondEntry !== firstEntry);
  assert('живая запись отменяемая', r.body?.cancellable === true);

  r = await asMe('/me/bookings');
  const cupEntries = (r.body ?? []).filter((entry) => entry.id === tournamentId);
  assert('в «Моих записях» обе строки, с разными ключами', cupEntries.length === 2 && new Set(cupEntries.map((entry) => entry.entryId)).size === 2);

  r = await asMe(`/clubs/yenisey/tournaments/${tournamentId}/registration`, { method: 'DELETE' });
  check('повторная отмена живой записи', 200, r.status);
  assert('отменена именно живая', r.body?.entryId === secondEntry && r.body?.status === 'CANCELLED');

  // --- Уборка. Занятие с записями не удаляется — сначала снимаем чужую.
  r = await asOther(`/clubs/yenisey/trainings/${sessionId}/booking`, { method: 'DELETE' });
  check('чужая запись снята', 200, r.status);

  r = await asAdmin(`/clubs/yenisey/training-sessions/${sessionId}`, { method: 'DELETE' });
  check('занятие с историей записей не удаляется', 409, r.status);

  r = await asAdmin(`/clubs/yenisey/tournaments/${tournamentId}`, { method: 'DELETE' });
  check('турнир с историей записей не удаляется', 409, r.status);
}

/**
 * Отметка на занятии и турнире.
 *
 * Мероприятия заводятся с началом через несколько секунд: записаться на
 * начавшееся нельзя, а отметить не начавшееся — тоже нельзя. Ни в одну сетку
 * они не поставлены, и это часть проверки: «Требует отметки» собирается по
 * всему клубу, а не из окон зала.
 */
async function eventAttendance(asMe) {
  const adminEmail = process.env.SMOKE_ADMIN_EMAIL;
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.log('\n=== 28. Отметка на мероприятиях — ПРОПУЩЕНА (нет учётки администратора)');
    return;
  }

  console.log('\n=== 28. Отметка на занятии и турнире');

  let r = await post('/auth/login', { email: adminEmail, password: adminPassword });
  const adminAuth = { Authorization: `Bearer ${r.body?.accessToken ?? ''}` };
  const asAdmin = (path, options = {}) =>
    call(path, { ...options, headers: { ...adminAuth, ...(options.headers ?? {}) } });

  r = await asAdmin('/clubs/yenisey/coaches');
  const coachId = r.body?.[0]?.id;

  r = await asAdmin('/clubs/yenisey/halls');
  const anyHall = r.body?.[0];

  if (!coachId || !anyHall) {
    console.log('     в клубе нет тренера или зала — сценарий пропущен');
    return;
  }

  r = await asAdmin('/clubs/yenisey/training-types');
  const trainingTypeId = r.body?.[0]?.id;
  r = await asAdmin('/clubs/yenisey/tournament-types');
  const tournamentTypeId = r.body?.[0]?.id;

  const startsAt = new Date(Date.now() + 4_000);
  const endsAt = new Date(startsAt.getTime() + 60 * 60_000);

  r = await asAdmin('/clubs/yenisey/training-sessions', {
    method: 'POST',
    json: {
      trainingTypeId,
      coachId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      capacity: 4,
    },
  });
  check('занятие через секунды заведено', 201, r.status);
  const sessionId = r.body?.id;

  r = await asAdmin('/clubs/yenisey/tournaments', {
    method: 'POST',
    json: { tournamentTypeId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
  });
  check('турнир через секунды заведён', 201, r.status);
  const tournamentId = r.body?.id;

  r = await asMe(`/clubs/yenisey/trainings/${sessionId}/booking`, { method: 'POST' });
  check('запись на занятие до начала', 201, r.status);
  r = await asMe(`/clubs/yenisey/tournaments/${tournamentId}/registration`, { method: 'POST' });
  check('запись на турнир до начала', 201, r.status);

  // Идентификаторы записей — из смены: по ним и отмечают.
  const deskToday = () =>
    asAdmin(`/clubs/yenisey/desk/halls/${anyHall.id}/days/${dateIn(anyHall.timezone, 0)}`);
  const entryOf = (desk, id) =>
    (desk?.pending?.events ?? []).find((event) => event.id === id)?.participants?.[0]?.entryId;

  const waitUntil = async (moment) => {
    const left = moment.getTime() - Date.now();
    if (left > 0) await new Promise((resolve) => setTimeout(resolve, left + 300));
  };

  await waitUntil(startsAt);

  r = await deskToday();
  check('смена открыта', 200, r.status);
  const trainingEntry = entryOf(r.body, sessionId);
  const tournamentEntry = entryOf(r.body, tournamentId);
  assert('начавшееся занятие вне сетки — в «Требует отметки»', typeof trainingEntry === 'string');
  assert('начавшийся турнир вне сетки — там же', typeof tournamentEntry === 'string');
  const pendingSession = (r.body?.pending?.events ?? []).find((event) => event.id === sessionId);
  assert('идущее занятие — в фазе «идёт»', pendingSession?.phase === 'ONGOING');
  assert('у ждущего занятия есть срок автонеявки', typeof pendingSession?.autoNoShowAt === 'string');

  r = await asMe(`/clubs/yenisey/trainings/${sessionId}/booking`, { method: 'DELETE' });
  check('отмена начавшегося занятия отклонена', 400, r.status);
  r = await asMe(`/clubs/yenisey/tournaments/${tournamentId}/registration`, { method: 'DELETE' });
  check('отмена начавшегося турнира отклонена', 400, r.status);

  r = await asMe('/me/bookings');
  const startedEntry = (r.body ?? []).find((entry) => entry.entryId === trainingEntry);
  assert('начавшееся занятие в «Моих записях» — без отмены', startedEntry?.cancellable === false);
  assert('у записи свой идентификатор, не занятия', startedEntry?.id === sessionId && startedEntry?.entryId !== sessionId);

  const batch = '/clubs/yenisey/desk/attendance';

  r = await asAdmin(batch, {
    method: 'POST',
    json: {
      marks: [
        { kind: 'TRAINING', entryId: trainingEntry, status: 'ATTENDED' },
        { kind: 'TRAINING', entryId: trainingEntry, status: 'ATTENDED' },
      ],
    },
  });
  check('одна запись дважды в пакете отклонена', 400, r.status);

  r = await asAdmin(batch, { method: 'POST', json: { marks: [] } });
  check('пустой пакет отклонён', 400, r.status);

  r = await asAdmin(batch, {
    method: 'POST',
    json: {
      marks: [
        { kind: 'TOURNAMENT', entryId: tournamentEntry, status: 'ATTENDED' },
        { kind: 'TRAINING', entryId: trainingEntry, status: 'ATTENDED' },
      ],
    },
  });
  check('пакетная отметка', 200, r.status);
  assert(
    'ответ — в порядке запроса, обе отмечены',
    r.body?.[0]?.kind === 'TOURNAMENT' &&
      r.body?.[1]?.kind === 'TRAINING' &&
      r.body.every((item) => item.status === 'ATTENDED' && item.changed === true),
  );

  r = await deskToday();
  const stillPending = (r.body?.pending?.events ?? []).map((event) => event.id);
  assert('отмеченные ушли из «Требует отметки»', !stillPending.includes(sessionId) && !stillPending.includes(tournamentId));

  r = await asAdmin(`${batch}/training/${trainingEntry}`, {
    method: 'PUT',
    json: { status: 'NO_SHOW', reason: 'Отметили по ошибке' },
  });
  check('присутствие исправлено на неявку с причиной', 200, r.status);

  r = await asAdmin(`${batch}/training/${trainingEntry}/history`);
  assert(
    'история занятия: отметка и исправление',
    r.body?.length === 2 && r.body?.[1]?.reason === 'Отметили по ошибке',
  );

  r = await asAdmin(`${batch}/tournament/${trainingEntry}`, { method: 'PUT', json: { status: 'ATTENDED' } });
  check('запись занятия по адресу турнира не находится', 404, r.status);
}

/**
 * Джоба автонеявки — только по явной просьбе.
 *
 * Нужны API с `ATTENDANCE_JOB=on ATTENDANCE_JOB_INTERVAL=10s` и
 * `SMOKE_AUTO_NO_SHOW=1` здесь. На время секции срок автонеявки клуба
 * опускается до минуты, и джоба закроет неявкой ВСЕ неотмеченные записи
 * клуба, закончившиеся в учётном окне больше минуты назад, — не только
 * заведённые смоуком. На базе разработки это законно, на чужой — нет.
 * Настройки клуба секция возвращает как были.
 */
async function autoNoShow(asMe) {
  const adminEmail = process.env.SMOKE_ADMIN_EMAIL;
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD;

  if (process.env.SMOKE_AUTO_NO_SHOW !== '1' || !adminEmail || !adminPassword) {
    console.log('\n=== 29. Джоба автонеявки — ПРОПУЩЕНА (нужны SMOKE_AUTO_NO_SHOW=1 и API с ATTENDANCE_JOB=on)');
    return;
  }

  console.log('\n=== 29. Джоба автонеявки');

  let r = await post('/auth/login', { email: adminEmail, password: adminPassword });
  const adminAuth = { Authorization: `Bearer ${r.body?.accessToken ?? ''}` };
  const asAdmin = (path, options = {}) =>
    call(path, { ...options, headers: { ...adminAuth, ...(options.headers ?? {}) } });

  r = await asAdmin('/clubs/yenisey/coaches');
  const coachId = r.body?.[0]?.id;
  r = await asAdmin('/clubs/yenisey/training-types');
  const trainingTypeId = r.body?.[0]?.id;

  if (!coachId || !trainingTypeId) {
    console.log('     в клубе нет тренера или типа тренировки — сценарий пропущен');
    return;
  }

  r = await asAdmin('/clubs/yenisey/settings');
  const original = {
    attendanceReminderAfterMinutes: r.body?.attendanceReminderAfterMinutes,
    attendanceAutoNoShowAfterMinutes: r.body?.attendanceAutoNoShowAfterMinutes,
  };
  const noShowPercent = r.body?.noShowChargePercent;

  try {
    r = await asAdmin('/clubs/yenisey/settings', {
      method: 'PATCH',
      json: { attendanceReminderAfterMinutes: 0, attendanceAutoNoShowAfterMinutes: 1 },
    });
    check('срок автонеявки опущен до минуты', 200, r.status);

    const startsAt = new Date(Date.now() + 3_000);
    const endsAt = new Date(startsAt.getTime() + 3_000);

    r = await asAdmin('/clubs/yenisey/training-sessions', {
      method: 'POST',
      json: {
        trainingTypeId,
        coachId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        capacity: 2,
      },
    });
    check('короткое занятие заведено', 201, r.status);
    const sessionId = r.body?.id;

    r = await asMe(`/clubs/yenisey/trainings/${sessionId}/booking`, { method: 'POST' });
    check('запись на короткое занятие', 201, r.status);
    const entryId = r.body?.entryId;

    // Минута после окончания плюс интервал джобы с запасом.
    const deadline = endsAt.getTime() + 150_000;
    let entry = null;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      r = await asMe('/me/bookings');
      entry = (r.body ?? []).find((item) => item.entryId === entryId);
      if (entry?.status !== 'BOOKED') break;
    }

    assert('джоба поставила неявку', entry?.status === 'NO_SHOW');
    assert('списание — по проценту клуба', entry?.chargePercent === noShowPercent);

    r = await asAdmin(`/clubs/yenisey/desk/attendance/training/${entryId}/history`);
    const auto = r.body?.[0];
    assert(
      'в журнале — система, без автора и с причиной',
      r.body?.length === 1 && auto?.auto === true && auto?.by === null && String(auto?.reason ?? '').includes('не отмечено'),
    );

    r = await asAdmin(`/clubs/yenisey/desk/attendance/training/${entryId}`, {
      method: 'PUT',
      json: { status: 'ATTENDED' },
    });
    check('исправить автонеявку без причины нельзя', 400, r.status);

    r = await asAdmin(`/clubs/yenisey/desk/attendance/training/${entryId}`, {
      method: 'PUT',
      json: { status: 'ATTENDED', reason: 'Забыли отметить' },
    });
    check('автонеявка исправлена администратором', 200, r.status);
    assert('после исправления — полное списание', r.body?.status === 'ATTENDED' && r.body?.chargePercent === 100);
  } finally {
    r = await asAdmin('/clubs/yenisey/settings', { method: 'PATCH', json: original });
    check('сроки присутствия клуба возвращены', 200, r.status);
  }
}

main().catch((error) => {
  console.error('Проверка не выполнена:', error.message);
  console.error('Поднят ли API? Ожидается на', API);
  process.exitCode = 1;
});
