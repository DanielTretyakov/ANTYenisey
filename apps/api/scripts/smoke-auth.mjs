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

/** Полный набор полей регистрации; отдельные поля перекрываются точечно. */
const registration = (overrides = {}) => ({
  tenantSlug: 'yenisey',
  email: `probe-${RUN}-${Math.random().toString(36).slice(2, 8)}@example.com`,
  password: PASSWORD,
  lastName: 'Иванов',
  firstName: 'Пётр',
  middleName: 'Сергеевич',
  phone: '+79991234567',
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
    'настройки клуба наружу не утекают',
    Object.keys(r.body ?? {}).join(',') === 'slug,name',
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

  console.log(`\nИТОГО: успешно ${passed}, провалов ${failed}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('Проверка не выполнена:', error.message);
  console.error('Поднят ли API? Ожидается на', API);
  process.exitCode = 1;
});
