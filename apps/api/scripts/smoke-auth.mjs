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

/** Полный набор полей регистрации; отдельные поля перекрываются точечно. */
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
  assert('роль по умолчанию — CLIENT', r.body?.user?.role === 'CLIENT');

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
    tenantSlug: 'yenisey',
    email: first.email,
    password: PASSWORD,
  });
  check('верный пароль', 200, r.status);
  r = await post('/auth/login', {
    tenantSlug: 'yenisey',
    email: first.email,
    password: 'nevernyi-parol-123',
  });
  check('неверный пароль', 401, r.status);
  r = await post('/auth/login', {
    tenantSlug: 'yenisey',
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
    tenantSlug: 'yenisey',
    email: first.email,
    password: PASSWORD,
  });
  const forLogout = r.body?.refreshToken;
  r = await post('/auth/logout', { refreshToken: forLogout });
  check('выход', 204, r.status);
  r = await post('/auth/refresh', { refreshToken: forLogout });
  check('погашенный выходом токен не работает', 401, r.status);

  console.log('=== 12. Публичное название клуба');
  r = await call('/tenants/yenisey');
  check('клуб найден без авторизации', 200, r.status);
  assert(
    `отдано официальное название «${r.body?.name}»`,
    typeof r.body?.name === 'string' && r.body.name.length > 0,
  );
  assert(
    'наружу отдан только код, название и часовой пояс',
    Object.keys(r.body ?? {}).join(',') === 'slug,name,timezone',
  );
  assert(
    'ни цен, ни политики отмены, ни статуса подписки в открытом ответе нет',
    !['noShowChargePercent', 'tableHourPrice', 'id'].some((key) => key in (r.body ?? {})),
  );
  r = await call('/tenants/net-takogo-kluba');
  check('несуществующий клуб', 404, r.status);

  console.log('=== 13. Валидация формы целиком');
  r = await post('/auth/register', {
    tenantSlug: 'yenisey',
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
    tenantSlug: 'yenisey',
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
      tenantSlug: 'yenisey',
      email: victim.email,
      password: `nevernyi-parol-${attempt}`,
    });
  }
  check(`попытка №${limit} — ещё 401, лимит не превышен`, 401, last.status);

  r = await post('/auth/login', {
    tenantSlug: 'yenisey',
    email: victim.email,
    password: `nevernyi-parol-${limit}`,
  });
  check(`попытка №${limit + 1} — перебор остановлен`, 429, r.status);

  // Ключ окна — «клуб + почта», поэтому заперта ровно одна учётка.
  r = await post('/auth/login', {
    tenantSlug: 'yenisey',
    email: first.email,
    password: PASSWORD,
  });
  check('вход в другую учётку не задет', 200, r.status);

  console.log('=== 17. Профиль клуба: кому закрыт');
  r = await call('/club/settings');
  check('без токена', 401, r.status);
  r = await call('/club/settings', { headers: { Authorization: `Bearer ${access}` } });
  check('клиенту закрыто', 403, r.status);
  r = await call('/club/halls', { headers: { Authorization: `Bearer ${access}` } });
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
      tenantSlug: 'yenisey',
      email: adminEmail,
      password: adminPassword,
    });
    check('вход администратора', 200, r.status);

    const adminAuth = { Authorization: `Bearer ${r.body?.accessToken ?? ''}` };
    const asAdmin = (path, options = {}) =>
      call(path, { ...options, headers: { ...adminAuth, ...options.headers } });
    const patchSettings = (json) => asAdmin('/club/settings', { method: 'PATCH', json });

    r = await asAdmin('/club/settings');
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
    r = await asAdmin('/club/halls');
    check('залы прочитаны', 200, r.status);
    const mainHall = r.body?.[0];
    assert('у зала есть цена аренды целым числом копеек', Number.isInteger(mainHall?.tableHourPrice));
    assert('у зала есть шаг бронирования', typeof mainHall?.bookingStep === 'string');

    const hallName = `Зал проверки ${RUN}`;
    r = await asAdmin('/club/halls', {
      method: 'POST',
      json: {
        name: hallName,
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

    r = await asAdmin('/club/halls', {
      method: 'POST',
      json: {
        name: hallName,
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

    r = await asAdmin(`/club/halls/${hallId}`, {
      method: 'PATCH',
      json: { hasRobotOption: true },
    });
    check('опция робота без цен отклонена', 400, r.status);
    assert(
      'в тексте перечислено, каких цен не хватает',
      JSON.stringify(r.body?.message ?? '').includes('30 минут'),
    );

    r = await asAdmin(`/club/halls/${hallId}`, { method: 'PATCH', json: { bookingStep: 'MIN_15' } });
    check('шаг бронирования зала изменён', 200, r.status);
    assert('ответ отдал новое значение', r.body?.bookingStep === 'MIN_15');

    console.log('=== 20. Столы в залах');
    const label = `Стол проверки ${RUN}`;
    r = await asAdmin('/club/tables', { method: 'POST', json: { hallId, label } });
    check('стол заведён в зале', 201, r.status);
    const tableId = r.body?.id;
    assert('стол знает свой зал', r.body?.hallId === hallId);
    assert('у нового стола нет расписания', r.body?.closureCount === 0);

    r = await asAdmin('/club/tables', { method: 'POST', json: { hallId, label } });
    check('повторное название в одном зале отклонено', 409, r.status);

    r = await asAdmin('/club/tables', {
      method: 'POST',
      json: { hallId: mainHall?.id, label },
    });
    check('то же название в СОСЕДНЕМ зале принято', 201, r.status);
    const twinId = r.body?.id;

    r = await asAdmin('/club/tables', { method: 'POST', json: { hallId: 'chuzhoy-zal', label: 'X' } });
    check('стол в несуществующий зал отклонён', 404, r.status);

    r = await asAdmin(`/club/halls/${hallId}`, { method: 'DELETE' });
    check('зал со столами удалить нельзя', 409, r.status);

    console.log('=== 21. Шаблон недели');
    const coaches = (await asAdmin('/club/coaches')).body ?? [];
    const coachId = coaches[0]?.id ?? null;

    if (!coachId) {
      console.log('     тренеров в клубе нет — проверки тренировок пропущены');
      console.log('     завести: pnpm db:create-admin -- --role COACH --email ... --name "..."');
    }

    r = await asAdmin(`/club/halls/${hallId}/template`);
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

    r = await asAdmin(`/club/halls/${hallId}/template`, {
      method: 'PUT',
      json: { rules: [window(), window({ startMinute: 1140, endMinute: 1200 })] },
    });
    check('шаблон сохранён', 200, r.status);
    assert('окна встык приняты — стык пересечением не считается', r.body?.length === 2);

    r = await asAdmin(`/club/halls/${hallId}/template`, {
      method: 'PUT',
      json: { rules: [window(), window({ startMinute: 1080, endMinute: 1200 })] },
    });
    check('наложение окон отклонено', 400, r.status);
    assert(
      'в тексте названы конфликтующие часы',
      JSON.stringify(r.body?.message ?? '').includes('15:00'),
    );

    r = await asAdmin(`/club/halls/${hallId}/template`, {
      method: 'PUT',
      json: { rules: [window({ weekday: 0 })] },
    });
    check('нулевой день недели отклонён', 400, r.status);

    r = await asAdmin(`/club/halls/${hallId}/template`, {
      method: 'PUT',
      json: { rules: [window({ endMinute: 1441 })] },
    });
    check('конец за пределами суток отклонён', 400, r.status);

    r = await asAdmin(`/club/halls/${hallId}/template`, {
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
    r = await asAdmin('/club/training-types', {
      method: 'POST',
      json: { name: trainingName, price: 70000 },
    });
    check('тип тренировки заведён', 201, r.status);
    const trainingTypeId = r.body?.id;
    assert('цена целым числом копеек', r.body?.price === 70000);

    r = await asAdmin('/club/training-types', {
      method: 'POST',
      json: { name: trainingName, price: 1 },
    });
    check('повторное название типа отклонено', 409, r.status);

    r = await asAdmin('/club/training-types', { method: 'POST', json: { name: '  ', price: 1 } });
    check('пустое название отклонено', 400, r.status);

    r = await asAdmin('/club/training-types', {
      method: 'POST',
      json: { name: `Дробная ${RUN}`, price: 700.5 },
    });
    check('дробная цена отклонена', 400, r.status);

    const tournamentTypeName = `Проверочный турнир ${RUN}`;
    r = await asAdmin('/club/tournament-types', {
      method: 'POST',
      json: { name: tournamentTypeName, ratingLabel: '100', price: 50000 },
    });
    check('тип турнира заведён', 201, r.status);
    const tournamentTypeId = r.body?.id;
    assert('ограничение по рейтингу сохранено как справочная строка', r.body?.ratingLabel === '100');

    r = await asAdmin('/club/tournaments', {
      method: 'POST',
      json: { tournamentTypeId, startsAt: '2026-10-03T04:00:00.000Z' },
    });
    check('турнир заведён', 201, r.status);
    const tournamentId = r.body?.id;
    assert('название типа приехало вместе с турниром', r.body?.typeName === tournamentTypeName);

    r = await asAdmin('/club/tournaments', {
      method: 'POST',
      json: { tournamentTypeId: 'chuzhoy-tip', startsAt: '2026-10-03T04:00:00.000Z' },
    });
    check('турнир по несуществующему типу отклонён', 404, r.status);

    r = await asAdmin(`/club/tournament-types/${tournamentTypeId}`, { method: 'DELETE' });
    check('тип с заведёнными турнирами удалить нельзя', 409, r.status);

    if (coachId) {
      r = await asAdmin(`/club/halls/${hallId}/template`, {
        method: 'PUT',
        json: { rules: [window({ purpose: 'TRAINING', coachId })] },
      });
      check('тренировка без типа отклонена', 400, r.status);
      assert(
        'сказано, что нужен тип',
        JSON.stringify(r.body?.message ?? '').includes('выберите тип'),
      );

      r = await asAdmin(`/club/halls/${hallId}/template`, {
        method: 'PUT',
        json: { rules: [window({ purpose: 'TRAINING', coachId, trainingTypeId })] },
      });
      check('тренировка с тренером и типом принята', 200, r.status);
      assert('тренер сохранён', r.body?.[0]?.coachId === coachId);
      assert('тип сохранён', r.body?.[0]?.trainingTypeId === trainingTypeId);

      // В шаблоне недели турнир записывается ТИПОМ: у конкретного проведения
      // есть дата, а шаблон повторяется.
      r = await asAdmin(`/club/halls/${hallId}/template`, {
        method: 'PUT',
        json: { rules: [window({ purpose: 'TOURNAMENT', tournamentId })] },
      });
      check('конкретное проведение в шаблон не принимается', 400, r.status);

      r = await asAdmin(`/club/halls/${hallId}/template`, {
        method: 'PUT',
        json: { rules: [window({ purpose: 'TOURNAMENT', tournamentTypeId })] },
      });
      check('турнир типом в шаблоне принят', 200, r.status);
      assert('тип турнира сохранён', r.body?.[0]?.tournamentTypeId === tournamentTypeId);

      r = await asAdmin(`/club/halls/${hallId}/template`, {
        method: 'PUT',
        json: { rules: [window({ purpose: 'TOURNAMENT' })] },
      });
      check('турнир в шаблоне без типа отклонён', 400, r.status);

      r = await asAdmin(`/club/halls/${hallId}/template`, {
        method: 'PUT',
        json: { rules: [window({ purpose: 'TOURNAMENT', tournamentTypeId: 'chuzhoy-tip' })] },
      });
      check('неизвестный тип турнира отклонён', 400, r.status);

      r = await asAdmin(`/club/halls/${hallId}/template`, {
        method: 'PUT',
        json: { rules: [window({ purpose: 'RENT', coachId })] },
      });
      check('тренер у аренды отклонён', 400, r.status);
    }

    console.log('=== 21д. Турнир в расписании дня');
    const cupDate = '2026-10-03';
    r = await asAdmin(`/club/halls/${hallId}/days/${cupDate}`, {
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

    r = await asAdmin('/club/tournaments');
    const placed = (r.body ?? []).find((item) => item.id === tournamentId);
    assert('турнир знает, что стоит в сетке', placed?.placedCount === 1);

    r = await asAdmin(`/club/tournaments/${tournamentId}`, { method: 'DELETE' });
    check('турнир из сетки удалить нельзя', 409, r.status);

    r = await asAdmin(`/club/halls/${hallId}/days/${cupDate}`, {
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
    const clients = (await asAdmin('/club/people?role=CLIENT&limit=1')).body?.items ?? [];
    const clientId = clients[0]?.id ?? null;

    if (!clientId) {
      console.log('     клиентов в клубе нет — проверки аренды пропущены');
    } else {
      r = await asAdmin(`/club/halls/${hallId}/template`, {
        method: 'PUT',
        json: { rules: [window({ purpose: 'RENT', clientId })] },
      });
      check('аренда с клиентом принята', 200, r.status);
      assert('клиент сохранён', r.body?.[0]?.clientId === clientId);

      r = await asAdmin(`/club/halls/${hallId}/template`, {
        method: 'PUT',
        json: { rules: [window({ purpose: 'RENT', clientId: null })] },
      });
      check('аренда без клиента тоже принята', 200, r.status);

      r = await asAdmin(`/club/halls/${hallId}/template`, {
        method: 'PUT',
        json: { rules: [window({ purpose: 'TRAINING', coachId, clientId })] },
      });
      check('клиент у тренировки отклонён', 400, r.status);

      // Поле, не присланное вовсе, — это undefined, а не null: проверки не
      // должны принимать его за заполненное.
      r = await asAdmin(`/club/halls/${hallId}/template`, {
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
    r = await call('/club/people', { headers: { Authorization: `Bearer ${access}` } });
    check('состав клуба клиенту закрыт', 403, r.status);

    r = await asAdmin('/club/people?limit=5');
    check('состав прочитан', 200, r.status);
    assert('пришли и список, и общее число', Array.isArray(r.body?.items) && typeof r.body?.total === 'number');
    assert('страница не длиннее запрошенного', (r.body?.items?.length ?? 0) <= 5);

    r = await asAdmin('/club/people?role=COACH');
    check('фильтр по роли', 200, r.status);
    assert(
      'в выборке только тренеры',
      Array.isArray(r.body?.items) && r.body.items.every((p) => p.role === 'COACH'),
    );

    r = await asAdmin('/club/people?role=NEIZVESTNAYA');
    check('неизвестная роль отклонена', 400, r.status);

    r = await asAdmin('/club/people?limit=999');
    check('запрос всего списка разом отклонён', 400, r.status);

    r = await asAdmin(`/club/people?search=${encodeURIComponent(first.email)}`);
    check('поиск по почте', 200, r.status);
    assert('нашёлся ровно один', r.body?.total === 1);

    const probe = r.body?.items?.[0];
    assert('телефон и дата рождения пришли', Boolean(probe?.phone) && Boolean(probe?.birthDate));

    console.log('=== 21г. Смена роли');
    r = await asAdmin(`/club/people/${probe.id}/role`, { method: 'PATCH', json: { role: 'COACH' } });
    check('клиент повышен до тренера', 200, r.status);
    assert('роль изменилась', r.body?.role === 'COACH');

    r = await asAdmin('/club/coaches');
    assert(
      'и он появился в списке тренеров — значит, профиль тренера заведён',
      Array.isArray(r.body) && r.body.some((coach) => coach.id === probe.id),
    );

    r = await asAdmin(`/club/people/${probe.id}/role`, { method: 'PATCH', json: { role: 'CLIENT' } });
    check('и разжалован обратно', 200, r.status);

    r = await asAdmin(`/club/people/${probe.id}/role`, { method: 'PATCH', json: { role: 'CLIENT' } });
    check('повтор той же роли отклонён', 409, r.status);

    r = await asAdmin(`/club/people/${probe.id}/role`, { method: 'PATCH', json: { role: 'KTO-TO' } });
    check('неизвестная роль отклонена', 400, r.status);

    // Себе роль менять нельзя: единственный владелец, разжаловавший себя,
    // запер бы клуб — вернуть роль было бы уже некому.
    const me = (await asAdmin('/auth/me')).body;
    r = await asAdmin(`/club/people/${me?.id}/role`, { method: 'PATCH', json: { role: 'CLIENT' } });
    check('свою роль изменить нельзя', 409, r.status);

    // Стол СОСЕДНЕГО зала в расписание этого зала попасть не должен: составной
    // внешний ключ проверяет клуб, но не зал.
    r = await asAdmin(`/club/halls/${hallId}/template`, {
      method: 'PUT',
      json: { rules: [window({ tableId: twinId })] },
    });
    check('чужой стол в расписании зала отклонён', 400, r.status);

    console.log('=== 22. Расписание на дату');
    const date = '2026-09-12';
    r = await asAdmin(`/club/halls/${hallId}/days/${date}`);
    check('день прочитан', 200, r.status);
    assert('неправленый день помечен как неправленый', r.body?.customised === false);
    assert('и окон у него нет', Array.isArray(r.body?.closures) && r.body.closures.length === 0);

    r = await asAdmin(`/club/halls/${hallId}/days/${date}`, {
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

    r = await asAdmin(`/club/halls/${hallId}/days`);
    check('список правленых дат прочитан', 200, r.status);
    assert('дата в списке', Array.isArray(r.body) && r.body.includes(date));

    // Пустое расписание правленого дня — осмысленное состояние: «в этот день
    // ничего не занято», а не «вернуть шаблон».
    r = await asAdmin(`/club/halls/${hallId}/days/${date}`, {
      method: 'PUT',
      json: { closures: [] },
    });
    check('пустой день сохранён', 200, r.status);
    assert('и он всё ещё правленый, а не сброшенный', r.body?.customised === true);

    r = await asAdmin(`/club/halls/${hallId}/days/${date}`, {
      method: 'PUT',
      json: {
        closures: [
          { tableId, startMinute: 600, endMinute: 720, purpose: 'RENT', coachId: null },
          { tableId, startMinute: 660, endMinute: 780, purpose: 'RENT', coachId: null },
        ],
      },
    });
    check('наложение окон в дне отклонено', 400, r.status);

    r = await asAdmin(`/club/halls/${hallId}/days/${date}`, { method: 'DELETE' });
    check('день возвращён к шаблону', 200, r.status);
    assert('признак правки снят', r.body?.customised === false);

    r = await asAdmin(`/club/halls/${hallId}/days/2026-13-45`, { method: 'DELETE' });
    check('несуществующая дата отклонена', 400, r.status);

    console.log('=== 24. Бронирование стола клиентом');
    // Бронь заводится в ОСНОВНОМ зале клуба, а не в зале проверки: за бронью
    // стоит платёж, внешний ключ стоит на Restrict, и стол с историей уже не
    // удалить — а зал проверки в конце убирается. Оставшиеся брони уносит
    // pnpm db:clean-probes вместе с probe-учётками.
    r = await call('/tenants/yenisey');
    const timezone = r.body?.timezone;
    assert('публичные сведения о клубе несут часовой пояс', typeof timezone === 'string');

    r = await post('/auth/register', registration());
    check('клиент для брони заведён', 201, r.status);
    const bookerAuth = { Authorization: `Bearer ${r.body?.accessToken ?? ''}` };
    const asBooker = (path, options = {}) =>
      call(path, { ...options, headers: { ...bookerAuth, ...(options.headers ?? {}) } });

    r = await asBooker('/booking/halls');
    check('клиент видит залы с ценами', 200, r.status);
    const bookingHall = r.body?.find((item) => item.id === mainHall?.id) ?? r.body?.[0];

    if (!bookingHall || !timezone) {
      console.log('     залов у клуба нет — бронирование пропущено');
    } else {
      const bookDate = dateIn(timezone, 1);

      r = await asBooker(`/booking/halls/${bookingHall.id}/days/${bookDate}`);
      check('сетка доступности прочитана', 200, r.status);
      const bookingDay = r.body;
      assert('сетка знает шаг брони зала', Number.isInteger(bookingDay?.stepMinutes));
      assert(
        'сетка идёт с 06:00 до полуночи',
        bookingDay?.openMinute === 360 && bookingDay?.closeMinute === 1440,
      );
      assert('у столов сетки есть список занятого', Array.isArray(bookingDay?.tables?.[0]?.busy));

      r = await asBooker(`/booking/halls/${bookingHall.id}/days/${dateIn(timezone, 60)}`);
      check('дата за горизонтом отклонена', 400, r.status);

      r = await asBooker(`/booking/halls/${bookingHall.id}/days/${dateIn(timezone, -1)}`);
      check('вчерашняя дата отклонена', 400, r.status);

      r = await asBooker(
        `/booking/quote?hallId=${bookingHall.id}&durationMinutes=60&withRobot=false`,
      );
      check('цена часа посчитана', 200, r.status);
      assert(
        `час стоит цену часа (${r.body?.price} против ${bookingHall.tableHourPrice})`,
        r.body?.price === bookingHall.tableHourPrice,
      );

      r = await asBooker(
        `/booking/quote?hallId=${bookingHall.id}&durationMinutes=80&withRobot=false`,
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
          r = await asBooker('/booking/bookings', {
            method: 'POST',
            json: { tableId: freeTable.tableId, startsAt, durationMinutes: 45, withRobot: false },
          });
          check('длительность не по шагу зала отклонена', 400, r.status);
        }

        r = await asBooker('/booking/bookings', {
          method: 'POST',
          json: {
            tableId: freeTable.tableId,
            startsAt: instantAt(bookDate, freeMinute + 7, timezone),
            durationMinutes: 60,
            withRobot: false,
          },
        });
        check('начало не по шагу зала отклонено', 400, r.status);

        r = await asBooker('/booking/bookings', {
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

        r = await asBooker('/booking/bookings', {
          method: 'POST',
          json: { tableId: freeTable.tableId, startsAt, durationMinutes: 60, withRobot: false },
        });
        check('повторная бронь того же времени отклонена', 400, r.status);

        r = await asBooker(`/booking/halls/${bookingHall.id}/days/${bookDate}`);
        const reread = r.body?.tables?.find((item) => item.tableId === freeTable.tableId);
        assert(
          'бронь появилась в сетке занятого времени',
          (reread?.busy ?? []).some((slot) => slot.startMinute === freeMinute),
        );

        r = await asBooker('/booking/bookings');
        check('список своих броней прочитан', 200, r.status);
        assert(
          'бронь в списке',
          (r.body ?? []).some((item) => item.id === bookingId),
        );

        r = await asAdmin('/booking/bookings', {
          method: 'POST',
          json: { tableId: freeTable.tableId, startsAt, durationMinutes: 60, withRobot: false },
        });
        check('администратору этот маршрут закрыт: у него нет карточки клиента', 403, r.status);

        r = await asBooker(`/booking/bookings/${bookingId}`, { method: 'DELETE' });
        check('бронь отменена', 200, r.status);
        assert('статус сменился', r.body?.status === 'CANCELLED');
        assert('процент списания зафиксирован', Number.isInteger(r.body?.chargePercent));
        assert('отменять больше нечего', r.body?.cancelChargePercentNow === null);

        r = await asBooker(`/booking/bookings/${bookingId}`, { method: 'DELETE' });
        check('повторная отмена отклонена', 400, r.status);

        r = await asBooker(`/booking/halls/${bookingHall.id}/days/${bookDate}`);
        const afterCancel = r.body?.tables?.find((item) => item.tableId === freeTable.tableId);
        assert(
          'отменённая бронь время больше не занимает',
          !(afterCancel?.busy ?? []).some((slot) => slot.startMinute === freeMinute),
        );
      }
    }

    console.log('=== 23. Уборка проверочных данных');
    await asAdmin(`/club/halls/${hallId}/days/${cupDate}`, { method: 'DELETE' });
    r = await asAdmin(`/club/tournaments/${tournamentId}`, { method: 'DELETE' });
    check('турнир убран', 204, r.status);
    r = await asAdmin(`/club/tournament-types/${tournamentTypeId}`, { method: 'DELETE' });
    check('тип турнира убран', 204, r.status);
    await asAdmin(`/club/halls/${hallId}/template`, { method: 'PUT', json: { rules: [] } });
    r = await asAdmin(`/club/training-types/${trainingTypeId}`, { method: 'DELETE' });
    check('тип тренировки убран', 204, r.status);
    r = await asAdmin(`/club/tables/${tableId}`, { method: 'DELETE' });
    check('стол проверки убран', 204, r.status);
    r = await asAdmin(`/club/tables/${twinId}`, { method: 'DELETE' });
    check('стол-двойник убран', 204, r.status);
    r = await asAdmin(`/club/halls/${hallId}`, { method: 'DELETE' });
    check('пустой зал удалён', 204, r.status);

    r = await patchSettings(originalSettings);
    check('настройки клуба возвращены в исходное состояние', 200, r.status);
    assert(
      'вернулось всё, а не часть',
      JSON.stringify(r.body) === JSON.stringify(originalSettings),
    );
  }

  console.log(`\nИТОГО: успешно ${passed}, провалов ${failed}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('Проверка не выполнена:', error.message);
  console.error('Поднят ли API? Ожидается на', API);
  process.exitCode = 1;
});
