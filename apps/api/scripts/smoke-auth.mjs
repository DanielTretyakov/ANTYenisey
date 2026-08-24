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

async function call(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
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

  return { status: response.status, body };
}

const post = (path, json) => call(path, { method: 'POST', json });

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

  console.log(`\nИТОГО: успешно ${passed}, провалов ${failed}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('Проверка не выполнена:', error.message);
  console.error('Поднят ли API? Ожидается на', API);
  process.exitCode = 1;
});
