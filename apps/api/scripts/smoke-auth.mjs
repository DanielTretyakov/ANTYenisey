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
/** Приоритетный зал администратора до прогона — возвращается в конце. */
let originalPreferredHall = null;

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
    'наружу отдана карточка клуба: код, название, города, оформление, контакты, залы, описание, баннер и тренеры',
    Object.keys(r.body ?? {}).sort().join(',') ===
      'accentColor,bannerFileId,city,coaches,description,email,halls,logoUrl,name,otherCities,phone,slug',
  );
  assert(
    'часового пояса в карточке клуба больше НЕТ — он свойство зала',
    !('timezone' in (r.body ?? {})),
  );
  assert(
    'ни политики отмены, ни статуса подписки, ни идентификаторов в открытом ответе нет',
    !['noShowChargePercent', 'attendanceAutoNoShowAfterMinutes', 'id'].some((key) => key in (r.body ?? {})),
  );

  // Залы и цены — это и есть ответ на вопросы, с которыми человек приходит на
  // страницу клуба: куда ехать и почём стол. Без авторизации: клуб выбирают
  // до того, как заводят учётку.
  const publicHall = (r.body?.halls ?? [])[0];
  assert('в карточке есть хотя бы один зал', publicHall !== undefined);
  assert(
    'у зала названы место и цена часа',
    typeof publicHall?.name === 'string' && Number.isInteger(publicHall?.tableHourPrice),
  );
  assert(
    'цена с роботом показана только там, где робот есть',
    (r.body?.halls ?? []).every((hall) => hall.robotHourPrice === null || hall.robotHourPrice > 0),
  );
  assert(
    'ни шага брони, ни часового пояса зала наружу не уходит',
    (r.body?.halls ?? []).every((hall) => !('bookingStep' in hall) && !('timezone' in hall)),
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
    // Баннер правкой настроек не ставится — он загружается файлом. Прочитанные
    // настройки несут bannerFileId, и вернуть их как есть значило бы получить 400.
    const patchSettings = ({ bannerFileId: _banner, ...json }) =>
      asAdmin('/clubs/yenisey/settings', { method: 'PATCH', json });

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

    // Контакты клуба: их видит посетитель страницы, и телефон уходит в ссылку
    // `tel:` — потому формат тот же, что у телефона человека.
    r = await patchSettings({ phone: '8 (391) 200-00-00' });
    check('телефон клуба в человеческом написании отклонён', 400, r.status);
    r = await patchSettings({ email: 'club.example.ru' });
    check('почта клуба без собаки отклонена', 400, r.status);

    r = await patchSettings({ phone: '+73912000001', email: 'probe@example.ru' });
    check('контакты клуба сохранены', 200, r.status);
    assert('и пришли обратно', r.body?.phone === '+73912000001' && r.body?.email === 'probe@example.ru');

    r = await call('/clubs/yenisey');
    assert('контакты видны на публичной карточке', r.body?.phone === '+73912000001');

    // Пустая строка означает «убрать контакт», а не мусор в поле.
    r = await patchSettings({ phone: '' });
    check('пустой телефон принят как «не указан»', 200, r.status);
    assert('и стал пустым', r.body?.phone === null);

    r = await patchSettings({
      phone: originalSettings?.phone ?? null,
      email: originalSettings?.email ?? null,
    });
    check('контакты клуба возвращены', 200, r.status);

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

    // Приоритетный зал — личный выбор сотрудника; прежний возвращается в
    // конце прогона, после удаления пробного зала.
    r = await asAdmin('/clubs/yenisey/me/preferences');
    check('приоритетный зал читается', 200, r.status);
    originalPreferredHall = r.body?.preferredHallId ?? null;

    r = await asAdmin('/clubs/yenisey/me/preferences', { method: 'PUT', json: { preferredHallId: hallId } });
    check('приоритетный зал выбран', 200, r.status);
    assert('выбор сохранился', r.body?.preferredHallId === hallId);

    r = await call('/clubs/sayany');
    const foreignHallId = r.body?.halls?.[0]?.id;
    r = await asAdmin('/clubs/yenisey/me/preferences', { method: 'PUT', json: { preferredHallId: foreignHallId } });
    check('зал чужого клуба приоритетным не ставится', 404, r.status);

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
                  trainingTypeId: null,
            tournamentId: null,
          },
        ],
      },
    });
    check('турнир без указания какой — отклонён', 400, r.status);

    console.log('=== 21б. У окна расписания клиента нет');
    // Клиент у окна был ловушкой: окно не несёт ни цены, ни статуса, ни
    // отмены, а человек, которого администратор вписал кистью «Аренда»,
    // считал себя записанным и не видел записи в кабинете. Время, занятое
    // человеком, — это бронь.
    const clients = (await asAdmin('/clubs/yenisey/people?role=CLIENT&limit=1')).body?.items ?? [];
    const clientId = clients[0]?.id ?? null;

    r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`, {
      method: 'PUT',
      json: { rules: [window({ purpose: 'RENT' })] },
    });
    check('аренда без клиента принята', 200, r.status);
    assert('клиента в ответе нет вовсе', !('clientId' in (r.body?.[0] ?? {})));

    if (clientId) {
      r = await asAdmin(`/clubs/yenisey/halls/${hallId}/template`, {
        method: 'PUT',
        json: { rules: [window({ purpose: 'RENT', clientId })] },
      });
      check('клиент у окна отклонён как лишнее поле', 400, r.status);
    }

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
    check('окно без полей тренера принято', 200, r.status);

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

    console.log('=== 22е. Новичок «с порога»: поиск и привязка');
    // Человек регистрируется сам — учётку за него никто не заводит. У стойки
    // администратор находит его по ТОЧНОЙ почте или телефону и привязывает.
    // Телефон свой: он в схеме не уникален, и с общим номером поиск по
    // телефону законно отвечает «несколько человек» — это проверяется ниже.
    const walkInOwnPhone = `+7999${String(RUN).slice(-7)}`;
    r = await post(
      '/auth/register',
      registration({ tenantSlug: undefined, phone: walkInOwnPhone }),
    );
    check('человек зарегистрировался сам, вне клуба', 201, r.status);
    const walkInId = r.body?.user?.id ?? '';
    const walkInEmail = r.body?.user?.email ?? '';
    const walkInPhone = r.body?.user?.phone ?? '';

    const lookup = (query) => asAdmin(`/clubs/yenisey/people/lookup?${query}`);

    r = await call(`/clubs/yenisey/people/lookup?email=${encodeURIComponent(walkInEmail)}`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    check('поиск клиенту закрыт', 403, r.status);

    r = await lookup(`email=${encodeURIComponent(walkInEmail.slice(0, 8))}`);
    check('кусок почты — не почта', 400, r.status);

    r = await lookup(`email=${encodeURIComponent(walkInEmail)}&phone=${encodeURIComponent(walkInPhone)}`);
    check('два поля сразу отклонены', 400, r.status);

    r = await lookup('email=nekto-takogo-net@example.com');
    check('поиск незнакомого', 200, r.status);
    assert('незнакомый не найден', r.body?.found === false && r.body?.person === null);

    r = await lookup(`email=${encodeURIComponent(walkInEmail.toUpperCase())}`);
    check('почта ищется без учёта регистра', 200, r.status);
    assert('найден и ещё не в клубе', r.body?.person?.id === walkInId && r.body?.person?.member === false);
    assert(
      'до привязки имя сокращено — не собрать базу перебором',
      /^\S+ \S\.$/.test(r.body?.person?.name ?? ''),
    );

    r = await lookup(`phone=${encodeURIComponent(walkInPhone)}`);
    assert('свой телефон находит того же человека', r.body?.person?.id === walkInId);

    // Телефон в схеме не уникален: у семьи он один на всех, и выбрать за
    // администратора, кто из них нужен, нельзя.
    r = await lookup('phone=%2B79991234567');
    assert(
      'общий телефон отвечает «несколько человек», а не первым попавшимся',
      r.body?.found === true && r.body?.ambiguous === true && r.body?.person === null,
    );

    r = await asAdmin(`/clubs/yenisey/people/${walkInId}`);
    check('карточка чужого платформе человека закрыта', 404, r.status);

    r = await asAdmin(`/clubs/yenisey/people/${walkInId}/attach`, { method: 'POST' });
    check('привязан к клубу', 200, r.status);
    assert('привязан клиентом', r.body?.role === 'CLIENT' && r.body?.id === walkInId);

    r = await asAdmin(`/clubs/yenisey/people/${walkInId}/attach`, { method: 'POST' });
    check('повторная привязка — то же состояние, а не ошибка', 200, r.status);

    r = await lookup(`email=${encodeURIComponent(walkInEmail)}`);
    assert(
      'своего клуба человек виден полным именем',
      r.body?.person?.member === true && !/\S\.$/.test(r.body?.person?.name ?? ''),
    );

    r = await asAdmin(`/clubs/yenisey/people/${walkInId}`);
    check('карточка привязанного открылась', 200, r.status);
    assert('история у новичка пуста', (r.body?.entries ?? []).length === 0);

    r = await asAdmin('/clubs/yenisey/people/net-takogo/attach', { method: 'POST' });
    check('привязать несуществующего нельзя', 404, r.status);

    console.log('=== 22д. Карточка клиента');
    const cardPath = `/clubs/yenisey/people/${seatedId}`;

    r = await call(cardPath, { headers: { Authorization: `Bearer ${access}` } });
    check('карточка клиенту закрыта', 403, r.status);

    r = await asAdmin('/clubs/yenisey/people/net-takogo-cheloveka');
    check('незнакомый человек', 404, r.status);

    r = await asAdmin(cardPath);
    check('карточка открыта администратору', 200, r.status);

    const card = r.body;
    assert('в карточке человек с телефоном', card?.person?.phone?.startsWith('+7') === true);
    assert('роль в клубе — клиент', card?.person?.role === 'CLIENT');

    // Сводка считается по тем же записям, что показаны ниже: две брони
    // «пришёл» плюс визит с порога, одна неявка, одна отмена, одна впереди.
    assert('визиты считают и брони, и порог', card?.summary?.visits === 3);
    assert('неявка сосчитана', card?.summary?.noShows === 1);
    assert('прощённая отмена поздней не считается',
      card?.summary?.cancellations === 1 && card?.summary?.lateCancellations === 0);
    assert('будущая бронь — предстоящая', card?.summary?.upcoming === 1);
    assert('начислено больше нуля', Number.isInteger(card?.summary?.accrued) && card.summary.accrued > 0);
    assert('последний визит известен', typeof card?.summary?.lastVisitAt === 'string');

    const cardEntries = card?.entries ?? [];
    assert('записи идут свежими сверху',
      cardEntries.length > 1 && cardEntries[0].startsAt >= cardEntries[1].startsAt);
    const cardMissed = cardEntries.find((item) => item.entryId === missedId);
    assert('в карточке видно, кто и почему поставил отметку',
      cardMissed?.mark?.reason === 'Стол сломался' && cardMissed?.mark?.auto === false);
    assert('визит с порога в карточке отдельно', (card?.visits ?? []).some((item) => item.id === visitId));

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
    check('пустой зал удалён, хоть он и выбран основным', 204, r.status);

    r = await asAdmin('/clubs/yenisey/me/preferences');
    assert('удалённый зал снят с приоритетных', r.body?.preferredHallId === null);

    r = await asAdmin('/clubs/yenisey/me/preferences', {
      method: 'PUT',
      json: { preferredHallId: originalPreferredHall },
    });
    check('прежний приоритетный зал возвращён', 200, r.status);

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
  assert('без запроса — крупнейшие, не больше двадцати', Array.isArray(r.body) && r.body.length > 0 && r.body.length <= 20);

  // Справочник — все города РФ, и искать надо по началу: «крас» — это
  // прежде всего Красноярск, а не Красноармейск.
  const cityQuery = (text, extra = '') => call(`/cities?query=${encodeURIComponent(text)}${extra}`);

  r = await cityQuery('крас');
  const krasnoyarsk = (r.body ?? []).find((city) => city.name === 'Красноярск');
  assert('«крас» первым находит Красноярск', r.body?.[0]?.name === 'Красноярск');

  r = await cityQuery('минус');
  const minusinsk = (r.body ?? []).find((city) => city.name === 'Минусинск');
  assert('Минусинск находится по началу названия', minusinsk !== undefined);

  r = await cityQuery('новгород');
  assert('по началу слова — оба Новгорода', (r.body ?? []).filter((city) => city.name.endsWith('Новгород')).length === 2);

  r = await cityQuery('орел');
  assert('«е» находит «ё»: Орёл', (r.body ?? []).some((city) => city.name === 'Орёл'));

  r = await cityQuery('%');
  assert('знак процента — не подстановка', Array.isArray(r.body) && r.body.length === 0);

  r = await cityQuery('а', '&limit=500');
  check('больше пятидесяти подсказок не просят', 400, r.status);

  if (krasnoyarsk) {
    r = await call(`/cities/${krasnoyarsk.id}`);
    check('город читается по идентификатору', 200, r.status);
    assert('тот самый город', r.body?.name === 'Красноярск' && r.body?.region === 'Красноярский край');
  }

  r = await call('/cities/net-takogo-goroda');
  check('неизвестный город', 404, r.status);

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

  // Лента «Ближайшее в моих клубах»: пять ближайших неповторяющихся — от
  // каждого мероприятия клуба только ближайшее проведение.
  r = await asMe('/me/feed');
  check('лента моих клубов читается', 200, r.status);
  const feed = r.body ?? [];
  assert('в ленте не больше пяти', feed.length <= 5);
  assert(
    'в ленте нет повторов одного мероприятия',
    new Set(feed.map((event) => `${event.club.slug}:${event.kind}:${event.title}`)).size === feed.length,
  );
  assert('лента — по времени', feed.every((event, i) => i === 0 || feed[i - 1].startsAt <= event.startsAt));

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
  await playerProfile();
  await coachCard();
  await clubPage();
  await sparring();
  await subscriptions();
  await family();
  await autoNoShow(asMe);
  await notifications();
  await clientNotifications();
  await staffNotifications();
  await digests();
  await webPush();

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

  // --- Окно мероприятия: открыто без входа, записавшиеся — кружками.
  // Описание пишется у типа — проверяем, что оно доходит до окна, и
  // возвращаем прежнее: тип настоящий, клубный.
  r = await asAdmin('/clubs/yenisey/training-types');
  const trainingType = (r.body ?? []).find((type) => type.id === trainingTypeId);
  r = await asAdmin(`/clubs/yenisey/training-types/${trainingTypeId}`, {
    method: 'PATCH',
    json: { name: trainingType?.name, price: trainingType?.price, description: '  Проверка описания  ' },
  });
  check('описание типа занятия сохранено', 200, r.status);
  assert('описание обрезано по краям', r.body?.description === 'Проверка описания');

  r = await call(`/clubs/yenisey/events/training/${sessionId}`);
  check('окно занятия открыто без входа', 200, r.status);
  assert('окно — того же занятия', r.body?.id === sessionId && r.body?.kind === 'TRAINING');
  assert('описание типа дошло до окна', r.body?.description === 'Проверка описания');
  assert('тренер — со ссылкой на карточку', r.body?.coach?.id === coachId);
  assert('клуб окна назван', r.body?.club?.slug === 'yenisey');
  assert('записавшийся взрослый — кружком со ссылкой', typeof r.body?.people?.[0]?.userId === 'string');
  assert('имя в кружке сокращено', /^\S+ \S\.$/.test(r.body?.people?.[0]?.name ?? ''));
  assert('анониму отметка «записан» пустая', r.body?.registered === null);

  r = await asAdmin(`/clubs/yenisey/training-types/${trainingTypeId}`, {
    method: 'PATCH',
    json: { name: trainingType?.name, price: trainingType?.price, description: trainingType?.description ?? null },
  });
  check('описание типа возвращено', 200, r.status);

  r = await asMe(`/clubs/yenisey/events/tournament/${tournamentId}`);
  check('окно турнира', 200, r.status);
  assert('в окне турнира вошедший записан', r.body?.registered === true);
  assert('у турнира тренера нет', r.body?.coach === null);

  r = await call(`/clubs/yenisey/events/tournament/${sessionId}`);
  check('занятие по адресу турнира не находится', 404, r.status);

  r = await call(`/clubs/yenisey/events/party/${sessionId}`);
  check('неизвестный вид мероприятия отклонён', 400, r.status);

  r = await call(`/clubs/yenisey/events/training/${sessionId}?for=${sessionId}`);
  check('окно за ребёнка без входа не открывается', 401, r.status);

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
  // Вне сетки занятие не видно ни в одном зале: после отметки ему остаётся
  // только список мероприятий дня без сетки — иначе оно пропало бы с экрана.
  assert(
    'отмеченное занятие вне сетки видно в смене дня',
    (r.body?.unplaced ?? []).some((event) => event.id === sessionId && event.participants.length === 1),
  );

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

/**
 * Профиль игрока: аватар, инвентарь, достижения, разряд и его проверка клубом.
 *
 * Свои пробные учётки, а не общая `asMe`: нужны взрослый и ребёнок в
 * «Енисее» и посторонний из другого клуба — у каждого свои права на чужой
 * профиль. Картинки делает `sharp` из зависимостей API: JPEG с EXIF и
 * координатами нужен настоящий, иначе проверять выброс метаданных не на чем.
 */
/**
 * Абонементы: продажа, списание визита при записи, возврат при отмене и
 * судьба визита при неявке.
 *
 * Здесь проверяется то, чего не видят ни типы, ни юнит-тесты правил: что
 * визит списывается в одной транзакции с записью, что гонка двух записей при
 * одном визите разводится блокировкой, и что при неявке визит не возвращается,
 * а при прощении — возвращается.
 */
async function subscriptions() {
  const adminEmail = process.env.SMOKE_ADMIN_EMAIL;
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.log('\n=== 34. Абонементы — ПРОПУЩЕНЫ (нет учётки администратора)');
    return;
  }

  console.log('\n=== 34. Абонементы');

  const as = (token) => (path, options = {}) =>
    call(path, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) } });

  let r = await post('/auth/login', { email: adminEmail, password: adminPassword });
  const asAdmin = as(r.body?.accessToken ?? '');

  // Учётка абонементов — одна и та же во всех прогонах, в отличие от
  // остальных разделов.
  //
  // Журнал абонементов не удаляется ничем и ни под каким флагом, а значит,
  // клиент, на чьи записи он ссылается, остаётся в базе навсегда (см.
  // `ledgerLocked` в clean-probes). Свежая учётка на каждый прогон копила бы
  // такой несносимый остаток без предела — эта копится один раз.
  const clientEmail = 'probe-subscriptions@example.com';

  r = await post('/auth/register', registration({ email: clientEmail, lastName: 'Абонементов', firstName: 'Роман' }));

  if (r.status === 409) {
    r = await post('/auth/login', { email: clientEmail, password: PASSWORD });
    check('учётка абонементов прошлых прогонов открыта', 200, r.status);
  } else {
    check('учётка абонементов заведена', 201, r.status);
  }

  const clientId = r.body?.user?.id;
  const asClient = as(r.body?.accessToken ?? '');

  // Остатки прошлых прогонов гасятся: подходящий абонемент выбирает сервер
  // сам, и забытый визит увёл бы проверку на чужую строку.
  for (const stale of (await asClient('/me/subscriptions')).body ?? []) {
    if (stale.club?.slug === 'yenisey' && stale.remainingVisits > 0) {
      await asAdmin(`/clubs/yenisey/people/${clientId}/subscriptions/${stale.id}/adjust`, {
        method: 'POST',
        json: { delta: -stale.remainingVisits, reason: 'Уборка перед проверкой' },
      });
    }
  }

  // Тренер занятий — тоже постоянный, и по той же причине: занятие, на которое
  // записывались абонементом, уборка не снесёт, а значит, не снесёт и тренера.
  // Первый попавшийся тренер клуба оставлял бы по такой учётке за прогон.
  const coachEmail = 'probe-subscriptions-coach@example.com';

  r = await post('/auth/register', registration({ email: coachEmail, lastName: 'Тренеров', firstName: 'Абонемент' }));

  if (r.status === 409) {
    r = await post('/auth/login', { email: coachEmail, password: PASSWORD });
  }

  const coachId = r.body?.user?.id;
  await asAdmin(`/clubs/yenisey/people/${coachId}/role`, { method: 'PATCH', json: { role: 'COACH' } });

  r = await asAdmin('/clubs/yenisey/training-types');
  const trainingTypeId = (r.body ?? [])[0]?.id;

  if (!trainingTypeId || !coachId) {
    console.log('  ПРОПУЩЕНО: в клубе нет типа тренировки');
    return;
  }

  // --- Тариф
  const planBody = {
    // Имя с точным префиксом уборки («Тариф проверки ») — иначе тариф
    // переживёт clean-probes и останется в клубе навсегда.
    name: 'Тариф проверки визитов',
    visitsCount: 1,
    durationDays: 30,
    price: 100000,
    trainingTypeIds: [trainingTypeId],
    tournamentTypeIds: [],
  };

  r = await asClient('/clubs/yenisey/subscription-plans', { method: 'POST', json: planBody });
  check('клиент тарифы не заводит', 403, r.status);

  r = await asAdmin('/clubs/yenisey/subscription-plans', {
    method: 'POST',
    json: { ...planBody, visitsCount: null, durationDays: null },
  });
  check('вечный безлимит отклонён', 400, r.status);

  // Тариф, как и учётка, один на все прогоны: проданные по нему абонементы
  // переживают уборку (журнал), а вместе с ними переживёт её и он сам.
  r = await asAdmin('/clubs/yenisey/subscription-plans');
  let planId = (r.body ?? []).find((plan) => plan.name === planBody.name)?.id;

  if (planId) {
    r = await asAdmin(`/clubs/yenisey/subscription-plans/${planId}`, { method: 'PATCH', json: planBody });
    check('тариф прошлых прогонов подхвачен', 200, r.status);
  } else {
    r = await asAdmin('/clubs/yenisey/subscription-plans', { method: 'POST', json: planBody });
    check('тариф заведён', 201, r.status);
    planId = r.body?.id;
  }

  // --- Продажа. Зал продажи задаёт и пояс, по которому кончится срок, и
  // смену, в деньгах которой продажа видна.
  r = await asAdmin('/clubs/yenisey/halls');
  const halls = r.body ?? [];
  const hallId = halls[0]?.id;

  r = await asClient(`/clubs/yenisey/people/${clientId}/subscriptions`, { method: 'POST', json: { planId, hallId } });
  check('клиент себе абонемент не продаёт', 403, r.status);

  r = await asAdmin(`/clubs/yenisey/people/${clientId}/subscriptions`, {
    method: 'POST',
    json: { planId, hallId: 'net-takogo-zala' },
  });
  check('продажа в чужой зал отклонена', 404, r.status);

  if (halls.length > 1) {
    r = await asAdmin(`/clubs/yenisey/people/${clientId}/subscriptions`, { method: 'POST', json: { planId } });
    check('без зала при нескольких залах — отказ', 400, r.status);
  }

  r = await asAdmin(`/clubs/yenisey/people/${clientId}/subscriptions`, {
    method: 'POST',
    json: { planId, hallId },
  });
  check('абонемент продан', 201, r.status);
  const subscriptionId = r.body?.id;
  assert('визиты и срок сняты с тарифа', r.body?.remainingVisits === 1 && r.body?.expiresAt !== null);
  assert('цена зафиксирована', r.body?.priceAtPurchase === 100000);

  // Деньги дня: продажа видна в зале продажи и только в нём. По клубу её
  // показывала бы каждая смена, и одни деньги посчитались бы дважды.
  const saleDate = dateIn(halls[0].timezone, 0);
  r = await asAdmin(`/clubs/yenisey/desk/halls/${hallId}/days/${saleDate}`);
  const money = r.body?.money;
  assert('продажа попала в деньги своего зала', (money?.subscriptionSales?.count ?? 0) > 0);
  assert(
    'и осталась рядом с итогом услуг, а не внутри него',
    money?.total === money?.tables + money?.trainings + money?.tournaments,
  );

  const otherHall = halls.find((hall) => hall.id !== hallId);

  if (otherHall) {
    r = await asAdmin(`/clubs/yenisey/desk/halls/${otherHall.id}/days/${dateIn(otherHall.timezone, 0)}`);
    assert('в чужом зале этой продажи нет', (r.body?.money?.subscriptionSales?.count ?? 0) === 0);
  }

  /** Остаток визитов глазами самого клиента: он же его и видит в кабинете. */
  const remaining = async () => {
    const mine = (await asClient('/me/subscriptions')).body ?? [];

    return mine.find((item) => item.id === subscriptionId)?.remainingVisits;
  };

  // --- Запись: визит списывается вместе с ней
  const startsAt = new Date(Date.now() + 5_000);
  const endsAt = new Date(startsAt.getTime() + 60 * 60_000);
  const session = async (capacity = 4) =>
    (
      await asAdmin('/clubs/yenisey/training-sessions', {
        method: 'POST',
        json: {
          trainingTypeId,
          coachId,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          capacity,
        },
      })
    ).body?.id;

  const first = await session();
  const second = await session();

  r = await asClient(`/clubs/yenisey/events`);
  const hint = (r.body ?? []).find((event) => event.id === first);
  assert('подсказка у кнопки — абонементом', hint?.payWith?.subscriptionId === subscriptionId);

  // Гонка: два параллельных запроса при одном визите. Один платит
  // абонементом, второй — по цене; минуса на балансе не бывает.
  const [one, two] = await Promise.all([
    asClient(`/clubs/yenisey/trainings/${first}/booking`, { method: 'POST' }),
    asClient(`/clubs/yenisey/trainings/${second}/booking`, { method: 'POST' }),
  ]);

  check('первая запись создана', 201, one.status);
  check('вторая запись создана', 201, two.status);
  const paid = [one, two].filter((response) => response.body?.paidBy !== null);
  assert('абонементом оплачена ровно одна запись', paid.length === 1, `оплачено: ${paid.length}`);
  assert('вторая пошла по цене', [one, two].some((response) => response.body?.paidBy === null));
  assert('визитов не осталось', (await remaining()) === 0);

  const bySub = paid[0];
  assert('исход отмены — визит вернётся', bySub.body?.cancelOutcome === 'REFUND');
  assert('процент отмены у абонемента не показывается', bySub.body?.cancelChargePercentNow === null);

  // --- Отмена возвращает визит (мягкое правило клуба — по умолчанию)
  r = await asClient(`/clubs/yenisey/trainings/${bySub.body.id}/booking`, { method: 'DELETE' });
  check('запись абонементом отменена', 200, r.status);
  assert('визит вернулся', (await remaining()) === 1);

  // --- Неявка визит не возвращает, прощение — возвращает
  r = await asClient(`/clubs/yenisey/trainings/${bySub.body.id}/booking`, { method: 'POST' });
  check('записался снова', 201, r.status);
  assert('визит снова списан', (await remaining()) === 0);

  const entryId = r.body?.entryId;
  await new Promise((resolve) => setTimeout(resolve, Math.max(startsAt.getTime() - Date.now() + 500, 0)));

  r = await asAdmin(`/clubs/yenisey/desk/attendance/training/${entryId}`, { method: 'PUT', json: { status: 'NO_SHOW' } });
  check('неявка отмечена', 200, r.status);
  assert('процент неявки по абонементу — 100', r.body?.chargePercent === 100);
  assert('визит не вернулся', (await remaining()) === 0);

  r = await asAdmin(`/clubs/yenisey/desk/attendance/training/${entryId}`, {
    method: 'PUT',
    json: { status: 'NO_SHOW', waiveCharge: true, reason: 'Проверка прощения' },
  });
  check('неявка прощена', 200, r.status);
  assert('визит вернулся', (await remaining()) === 1);

  // --- Покрытие тарифа. Проверяется, ПОКА абонемент действует: у выбранного
  // абонемента правило защищает купленное, а не тариф сам по себе.
  r = await asAdmin(`/clubs/yenisey/subscription-plans/${planId}`, {
    method: 'PATCH',
    json: { ...planBody, trainingTypeIds: [] },
  });
  check('услугу из проданного тарифа не убрать', 409, r.status);

  // --- Корректировка
  r = await asAdmin(`/clubs/yenisey/people/${clientId}/subscriptions/${subscriptionId}/adjust`, {
    method: 'POST',
    json: { delta: -1, reason: '   ' },
  });
  check('корректировка без причины отклонена', 400, r.status);

  r = await asAdmin(`/clubs/yenisey/people/${clientId}/subscriptions/${subscriptionId}/adjust`, {
    method: 'POST',
    json: { delta: -5, reason: 'Больше, чем есть' },
  });
  check('корректировка ниже нуля отклонена', 400, r.status);

  r = await asAdmin(`/clubs/yenisey/people/${clientId}/subscriptions/${subscriptionId}/adjust`, {
    method: 'POST',
    json: { delta: -1, reason: 'Возврат абонемента' },
  });
  check('корректировка до нуля прошла', 201, r.status);
  assert('остаток ноль', r.body?.remainingVisits === 0);

  r = await asAdmin(`/clubs/yenisey/people/${clientId}/subscriptions/${subscriptionId}/ledger`);
  const reasons = (r.body ?? []).map((row) => row.reason);
  assert('в журнале нет строк «сгорел»', !reasons.includes('VISIT_BURNED'));
  assert('журнал сошёлся с остатком', (r.body ?? []).reduce((sum, row) => sum + row.delta, 0) === 0);

  // --- История абонементов клуба: тот же журнал, но по всему клубу сразу.
  r = await asClient('/clubs/yenisey/subscriptions/ledger');
  check('клиенту история клуба закрыта', 403, r.status);

  r = await asAdmin('/clubs/yenisey/subscriptions/ledger?limit=200');
  check('история клуба читается', 200, r.status);
  assert('движения этого абонемента в ней есть',
    (r.body?.items ?? []).some((row) => row.subscriptionId === subscriptionId));
  assert('у строки есть владелец и тариф',
    (r.body?.items ?? []).every((row) => typeof row.person?.fullName === 'string' && typeof row.planName === 'string'));
  assert('всего движений не меньше показанных', (r.body?.total ?? 0) >= (r.body?.items ?? []).length);

  r = await asAdmin('/clubs/yenisey/subscriptions/ledger?search=Абонементов');
  assert('поиск по фамилии сужает выборку',
    (r.body?.items ?? []).every((row) => row.person?.fullName?.includes('Абонементов')));

  r = await asAdmin('/clubs/yenisey/subscriptions/ledger?search=Нетаковогочеловека');
  assert('по незнакомой фамилии пусто', (r.body?.total ?? -1) === 0);

  // --- Изоляция клубов
  r = await asAdmin(`/clubs/sayany/people/${clientId}/subscriptions`, { method: 'POST', json: { planId } });
  assert('чужой клуб не отдаёт продажу', r.status === 403 || r.status === 404, `получено ${r.status}`);

  r = await asAdmin('/clubs/sayany/subscriptions/ledger');
  assert('и чужую историю не показывает', r.status === 403 || r.status === 404, `получено ${r.status}`);
}

/**
 * Спарринг: стол, который берёт тренер.
 *
 * Здесь проверяется то, чего не видят типы: что маршрут закрыт всем, кроме
 * тренера, что бронь занимает стол наравне с клиентской, что ученик в ней не
 * записан и что на смене она приходит с пометкой.
 */
async function sparring() {
  const adminEmail = process.env.SMOKE_ADMIN_EMAIL;
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.log('\n=== 33. Спарринг — ПРОПУЩЕН (нет учётки администратора)');
    return;
  }

  console.log('\n=== 33. Спарринг тренера');

  const as = (token) => (path, options = {}) =>
    call(path, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) } });

  let r = await post('/auth/login', { email: adminEmail, password: adminPassword });
  const asAdmin = as(r.body?.accessToken ?? '');

  r = await post('/auth/register', registration({ lastName: 'Спаррингов', firstName: 'Илья' }));
  const coachId = r.body?.user?.id;
  const asCoach = as(r.body?.accessToken ?? '');

  r = await post('/auth/register', registration({ lastName: 'Игроков', firstName: 'Семён' }));
  const asClient = as(r.body?.accessToken ?? '');

  // Клиенту этот маршрут закрыт и до, и после того, как у кого-то появится
  // роль тренера: решает роль, а не наличие карточки.
  r = await asClient('/clubs/yenisey/coach/sparring');
  check('клиенту спарринг закрыт', 403, r.status);

  r = await asAdmin(`/clubs/yenisey/people/${coachId}/role`, { method: 'PATCH', json: { role: 'COACH' } });
  check('роль тренера выдана', 200, r.status);

  r = await asCoach('/clubs/yenisey/booking/halls');
  const hall = (r.body ?? []).find((item) => item.bookingStep);
  assert('тренер видит залы клуба', hall !== undefined);

  // Свободное время ищется в сетке, а не выдумывается: у зала свой пояс и своё
  // расписание, и «завтра в 12:00» может быть закрыто шаблоном недели.
  const date = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  r = await asCoach(`/clubs/yenisey/booking/halls/${hall?.id}/days/${date}`);
  check('сетка дня открыта тренеру', 200, r.status);

  const table = (r.body?.tables ?? [])[0];
  const step = r.body?.stepMinutes ?? 30;
  const free = freeMinute(table?.busy ?? [], r.body?.earliestMinute ?? 0, step, 60);

  if (!table || free === null) {
    console.log('  ПРОПУЩЕНО: в этот день нет свободного часа — сценарий не показателен');
    return;
  }

  // Минуты сетки — местные, в поясе ЗАЛА. Перевод в момент времени повторяет
  // веб: собрать «наивное» время и подогнать его двумя проходами.
  const payload = {
    tableId: table.tableId,
    startsAt: instantAt(date, free, hall.timezone),
    durationMinutes: 60,
    withRobot: false,
  };

  r = await asClient('/clubs/yenisey/coach/sparring', { method: 'POST', json: payload });
  check('клиент спарринг не заводит', 403, r.status);

  r = await asCoach('/clubs/yenisey/coach/sparring', { method: 'POST', json: payload });
  check('тренер взял стол', 201, r.status);
  const sparringId = r.body?.id;
  assert('цена посчитана сервером', typeof r.body?.price === 'number' && r.body.price > 0);

  r = await asCoach('/clubs/yenisey/coach/sparring');
  assert('спарринг в своём списке', (r.body ?? []).some((b) => b.id === sparringId));

  // Занятое тренером время занято для всех: разводит их exclusion-констрейнт,
  // а не проверка в коде.
  r = await asClient('/clubs/yenisey/booking/bookings', { method: 'POST', json: payload });
  check('клиент на это время не влезет', 400, r.status);

  r = await asAdmin(`/clubs/yenisey/desk/bookings?from=${date}`);
  const seen = (r.body ?? []).find((b) => b.id === sparringId);
  assert('на смене видно как спарринг', seen?.sparring === true);
  assert('и за столом — тренер', seen?.client?.fullName?.startsWith('Спаррингов') === true);

  // Тренер — не клиент, и в клиентских списках его спарринга нет.
  r = await asCoach('/me/bookings');
  check('тренеру «мои записи» открыты как чтение', 200, r.status);
  assert('но спарринга там нет', !(r.body ?? []).some((e) => e.id === sparringId));

  // Деньги спарринга: заблаговременная отмена бесплатна, неявка стоит всей
  // аренды. Клубная политика отмены к тренеру не применяется — у неё другой
  // адресат (решение владельца от 20.09.2026).
  r = await asCoach('/clubs/yenisey/coach/sparring');
  const mine = (r.body ?? []).find((b) => b.id === sparringId);
  assert('отмена спарринга обещана бесплатной', mine?.cancelChargePercentNow === 0);

  r = await asCoach(`/clubs/yenisey/coach/sparring/${sparringId}`, { method: 'DELETE' });
  check('тренер отменил спарринг', 200, r.status);
  assert('и не списано ничего', r.body?.chargePercent === 0);

  r = await asClient('/clubs/yenisey/booking/bookings', { method: 'POST', json: payload });
  check('после отмены время снова свободно', 201, r.status);
}

/** Первая минута сетки, где подряд свободно `needed` минут. */
function freeMinute(busy, earliest, step, needed) {
  const CLOSE = 24 * 60;

  for (let minute = Math.max(earliest, 10 * 60); minute + needed <= CLOSE; minute += step) {
    const clash = busy.some((span) => minute < span.endMinute && span.startMinute < minute + needed);

    if (!clash) {
      return minute;
    }
  }

  return null;
}

/**
 * Карточка тренера: кто правит, что видно без входа, куда девается фото.
 *
 * Здесь проверяется ровно то, чего не видят типы: что маршруты закрыты ролью
 * именно в этом клубе, что публичная страница и фотография отдаются анониму, и
 * что негодный адрес соцсети не доезжает до базы.
 */
async function coachCard() {
  const adminEmail = process.env.SMOKE_ADMIN_EMAIL;
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.log('\n=== 32. Карточка тренера — ПРОПУЩЕН (нет учётки администратора)');
    return;
  }

  console.log('\n=== 32. Карточка тренера');

  const { default: sharp } = await import('sharp');

  const as = (token) => (path, options = {}) =>
    call(path, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) } });

  const upload = async (token, path) => {
    const bytes = await sharp({
      create: { width: 300, height: 300, channels: 3, background: { r: 20, g: 110, b: 90 } },
    }).png().toBuffer();

    const form = new FormData();
    form.set('file', new Blob([bytes], { type: 'image/png' }), 'coach.png');

    const response = await fetch(`${API}${path}`, {
      method: 'PUT',
      body: form,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body };
  };

  let r = await post('/auth/login', { email: adminEmail, password: adminPassword });
  const adminToken = r.body?.accessToken ?? '';
  const asAdmin = as(adminToken);

  r = await post('/auth/register', registration({ lastName: 'Тренеров', firstName: 'Павел' }));
  check('будущий тренер заведён', 201, r.status);
  const coachId = r.body?.user?.id;
  const coachToken = r.body?.accessToken ?? '';
  const asCoach = as(coachToken);

  r = await post('/auth/register', registration({ lastName: 'Клиентов', firstName: 'Роман' }));
  const asClient = as(r.body?.accessToken ?? '');

  // Карточка платформенная, но открыта не всем: тренером надо быть хотя бы в
  // одном клубе. Клубный guard здесь бессилен — клуба в адресе нет.
  r = await asCoach('/me/coach-card');
  check('не тренеру карточка закрыта', 403, r.status);

  r = await asAdmin(`/clubs/yenisey/people/${coachId}/role`, { method: 'PATCH', json: { role: 'COACH' } });
  check('роль тренера выдана', 200, r.status);

  r = await asCoach('/me/coach-card');
  check('карточка открылась вместе с ролью', 200, r.status);
  assert('и она пуста', r.body?.photoFileId === null && r.body?.achievements === null
    && Array.isArray(r.body?.socialLinks) && r.body.socialLinks.length === 0);

  r = await asCoach('/me/coach-card', { method: 'PATCH', json: { achievements: '  Мастер спорта  ' } });
  check('тренер правит свою карточку', 200, r.status);
  assert('пробелы по краям срезаны', r.body?.achievements === 'Мастер спорта');
  assert('о чём не спрашивали — не тронуто', r.body?.inventory === null);

  r = await asCoach('/me/coach-card', {
    method: 'PATCH',
    json: { socialLinks: [{ label: 'Сайт', url: 'javascript:alert(1)' }] },
  });
  check('адрес не http(s) отклонён', 400, r.status);

  r = await asCoach('/me/coach-card', {
    method: 'PATCH',
    json: { socialLinks: [{ label: 'ВКонтакте', url: 'https://vk.com/probe' }] },
  });
  check('ссылка сохранена', 200, r.status);
  assert('ровно одна', r.body?.socialLinks?.length === 1);

  r = await asClient('/me/coach-card', { method: 'PATCH', json: { achievements: 'я тоже тренер' } });
  check('клиенту карточка тренера не открывается вовсе', 403, r.status);

  // --- Цены. Они клубные, в отличие от карточки, и правит их тоже сам тренер:
  // администратору маршрута правки больше не существует.
  r = await asCoach('/clubs/yenisey/coach/prices');
  check('свои цены в клубе читаются', 200, r.status);
  assert('и они не заданы', r.body?.groupPrice === null && r.body?.individualPrice === null);

  r = await asCoach('/clubs/yenisey/coach/prices', {
    method: 'PATCH',
    json: { groupPrice: 60000, individualPrice: 150000, priceNote: '  первое занятие бесплатно  ' },
  });
  check('тренер задаёт цены клуба', 200, r.status);
  assert('приписка обрезана по краям', r.body?.priceNote === 'первое занятие бесплатно');

  r = await asCoach('/clubs/yenisey/coach/prices', { method: 'PATCH', json: { groupPrice: -1 } });
  check('отрицательная цена отклонена', 400, r.status);

  r = await asClient('/clubs/yenisey/coach/prices', { method: 'PATCH', json: { groupPrice: 1 } });
  check('клиент цены тренера не правит', 403, r.status);

  r = await asAdmin(`/clubs/yenisey/coaches/${coachId}`, { method: 'PATCH', json: { achievements: 'за него' } });
  check('администратор чужую карточку больше не правит', 404, r.status);

  r = await asAdmin(`/clubs/yenisey/people/${coachId}`);
  assert('карточка тренера и цены клуба пришли вместе с карточкой человека',
    r.body?.coach?.card?.achievements === 'Мастер спорта' && r.body?.coach?.prices?.groupPrice === 60000);

  r = await upload(null, '/me/coach-card/photo');
  check('фото без входа не загрузить', 401, r.status);

  r = await upload(coachToken, '/me/coach-card/photo');
  check('тренер грузит своё фото', 200, r.status);
  const photoId = r.body?.photoFileId;
  assert('фото появилось в карточке', typeof photoId === 'string' && photoId.length > 0);

  // Публичная страница и фотография — без входа: у карточки тренера возраста
  // нет, и это главное её отличие от страницы игрока.
  r = await call(`/coaches/${coachId}`);
  check('публичная карточка открыта без входа', 200, r.status);
  assert('имя сокращено до «Фамилия И.»', r.body?.name === 'Тренеров П.');
  assert('клуб назван со своей ценой, и он один',
    r.body?.clubs?.length === 1 && r.body.clubs[0]?.slug === 'yenisey' && r.body.clubs[0]?.groupPrice === 60000);

  const photo = await fetch(`${API}/files/${photoId}`);
  check('фотография отдаётся без входа', 200, photo.status);
  assert('и она перекодирована в WebP', photo.headers.get('content-type') === 'image/webp');

  r = await asCoach('/clubs/yenisey/coach/groups');
  check('свои группы читаются', 200, r.status);
  assert('впереди занятий нет', Array.isArray(r.body) && r.body.length === 0);

  r = await asClient('/clubs/yenisey/coach/groups');
  check('клиенту чужие группы закрыты', 403, r.status);

  r = await call('/coaches/net-takogo-trenera');
  check('несуществующий тренер — 404', 404, r.status);

  r = await asAdmin(`/clubs/yenisey/coaches/${coachId}/photo`, { method: 'DELETE' });
  check('администратор чужое фото не убирает', 404, r.status);

  r = await asCoach('/me/coach-card/photo', { method: 'DELETE' });
  check('фото убрано', 200, r.status);
  assert('и карточка о нём забыла', r.body?.photoFileId === null);

  // --- Статистика. Арифметику держат юнит-тесты `coach-stats.test.ts`, здесь —
  // доступ и то, что запрос к базе складывается в согласованные цифры.
  r = await asCoach('/clubs/yenisey/coach/stats');
  check('своя статистика читается', 200, r.status);
  assert('по умолчанию — за 90 дней', r.body?.period === 90);
  assert('у нового тренера занятий нет, и средние пусты',
    r.body?.sessions === 0 && r.body?.attendanceRate === null && r.body?.averageFill === null);

  r = await asCoach('/clubs/yenisey/coach/stats?period=17');
  check('произвольный срок отклонён', 400, r.status);

  r = await asClient('/clubs/yenisey/coach/stats');
  check('клиенту статистика тренера закрыта', 403, r.status);

  r = await asClient(`/clubs/yenisey/coaches/${coachId}/stats`);
  check('и чужая — тоже', 403, r.status);

  r = await asAdmin('/clubs/yenisey/coaches/net-takogo-trenera/stats');
  check('статистика не-тренера — 404, а не пустые цифры', 404, r.status);

  // На тренере с историей (сид и прошлые прогоны) — не конкретные числа, а
  // то, что они сходятся друг с другом.
  r = await asAdmin('/clubs/yenisey/coaches');
  let seasoned = null;

  for (const coach of r.body ?? []) {
    const stats = (await asAdmin(`/clubs/yenisey/coaches/${coach.id}/stats?period=0`)).body;

    if (stats?.sessions > 0) {
      seasoned = stats;
      break;
    }
  }

  if (seasoned) {
    assert('записи сходятся: пришли + неявки + отмены + без отметки',
      seasoned.attended + seasoned.noShows + seasoned.cancelled + seasoned.unmarked === seasoned.entries);
    assert('посещаемость в пределах 0..100 или пуста',
      seasoned.attendanceRate === null || (seasoned.attendanceRate >= 0 && seasoned.attendanceRate <= 100));
  } else {
    console.log('  ПРОПУЩЕНО: ни у одного тренера клуба нет проведённых занятий');
  }
}

async function playerProfile() {
  const adminEmail = process.env.SMOKE_ADMIN_EMAIL;
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.log('\n=== 30. Профиль игрока — ПРОПУЩЕН (нет учётки администратора)');
    return;
  }

  console.log('\n=== 30. Профиль игрока: файлы, инвентарь, достижения');

  const { default: sharp } = await import('sharp');

  const as = (token) => (path, options = {}) =>
    call(path, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) } });

  /** multipart/form-data: `call` ставит JSON-заголовок, здесь он мешал бы. */
  const upload = async (token, path, fields = {}, file = null, method = 'PUT') => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    if (file) form.set('file', new Blob([file.bytes], { type: file.type }), file.name);

    const response = await fetch(`${API}${path}`, {
      method,
      body: form,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body };
  };

  /** Файл целиком — с заголовками и байтами. */
  const download = async (token, id) => {
    const response = await fetch(`${API}/files/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return { status: response.status, headers: response.headers, bytes: new Uint8Array(await response.arrayBuffer()) };
  };

  let r = await post('/auth/login', { email: adminEmail, password: adminPassword });
  const adminToken = r.body?.accessToken ?? '';
  const asAdmin = as(adminToken);
  r = await asAdmin('/auth/me');
  const adminId = r.body?.id;

  r = await post('/auth/register', registration({ lastName: 'Ракеткин', firstName: 'Игорь' }));
  check('игрок заведён', 201, r.status);
  const playerToken = r.body?.accessToken ?? '';
  const playerId = r.body?.user?.id;
  const asPlayer = as(playerToken);

  const minorEmail = `probe-${RUN}-minor-${Math.random().toString(36).slice(2, 6)}@example.com`;
  r = await post('/auth/register', registration({ email: minorEmail, lastName: 'Юнцов', firstName: 'Коля', birthDate: '2014-03-01' }));
  check('игрок младше 16 заведён', 201, r.status);
  const minorToken = r.body?.accessToken ?? '';
  const minorId = r.body?.user?.id;

  r = await post('/auth/register', registration({ tenantSlug: 'sayany', lastName: 'Соседов' }));
  check('игрок другого клуба заведён', 201, r.status);
  const outsiderToken = r.body?.accessToken ?? '';
  const outsiderId = r.body?.user?.id;

  r = await call('/me/player');
  check('свой профиль без входа', 401, r.status);

  r = await asPlayer('/me/player');
  check('свой профиль читается', 200, r.status);
  assert('профиль пуст, взрослый — публичный',
    r.body?.avatarFileId === null && r.body?.rank === null && r.body?.achievements?.length === 0 && r.body?.isPublic === true);

  r = await asPlayer('/me/player', { method: 'PATCH', json: { blade: '  Butterfly Viscaria  ', forehandRubber: '   ' } });
  check('инвентарь сохранён', 200, r.status);
  assert('пробелы срезаны, пустое — null',
    r.body?.equipment?.blade === 'Butterfly Viscaria' && r.body?.equipment?.forehandRubber === null);

  r = await asPlayer('/me/player', { method: 'PATCH', json: { backhandRubber: 'Tenergy 05' } });
  assert('PATCH не стирает то, о чём не спрашивали',
    r.body?.equipment?.blade === 'Butterfly Viscaria' && r.body?.equipment?.backhandRubber === 'Tenergy 05');

  r = await asPlayer('/me/player', { method: 'PATCH', json: { blade: 'x'.repeat(101) } });
  check('основание длиннее 100 символов', 400, r.status);

  console.log('=== 30а. Аватар');
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  r = await upload(playerToken, '/me/player/avatar', {}, { bytes: svg, type: 'image/svg+xml', name: 'a.svg' });
  check('SVG аватаром не принимается', 400, r.status);

  const html = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');
  r = await upload(playerToken, '/me/player/avatar', {}, { bytes: html, type: 'image/png', name: 'a.png' });
  check('HTML под видом PNG не принимается', 400, r.status);

  r = await upload(playerToken, '/me/player/avatar');
  check('загрузка без файла', 400, r.status);

  const tooBig = new Uint8Array(6 * 1024 * 1024);
  tooBig.set([0xff, 0xd8, 0xff]);
  r = await upload(playerToken, '/me/player/avatar', {}, { bytes: tooBig, type: 'image/jpeg', name: 'big.jpg' });
  check('аватар больше 5 МБ', 400, r.status);

  const huge = new Uint8Array(11 * 1024 * 1024);
  r = await upload(playerToken, '/me/player/avatar', {}, { bytes: huge, type: 'image/jpeg', name: 'huge.jpg' });
  check('файл больше 10 МБ обрывается на разборе', 413, r.status);
  assert('и сообщение по-русски', /МБ/.test(String(r.body?.message ?? '')));

  const photo = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 30, g: 120, b: 90 } } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'Phone', Model: 'Camera' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '56/1 0/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '92/1 52/1 0/1' },
    })
    .toBuffer();
  r = await upload(playerToken, '/me/player/avatar', {}, { bytes: photo, type: 'image/jpeg', name: 'me.jpg' });
  check('фотография с телефона принята', 200, r.status);
  const avatarId = r.body?.avatarFileId;
  assert('у профиля появился аватар', typeof avatarId === 'string');

  let file = await download(null, avatarId);
  check('аватар взрослого открыт без входа', 200, file.status);
  assert('отдан WebP', file.headers.get('content-type') === 'image/webp');
  assert('браузеру запрещено угадывать тип', file.headers.get('x-content-type-options') === 'nosniff');
  assert('открытый аватар кешируется', /public/.test(file.headers.get('cache-control') ?? ''));
  const avatarMeta = await sharp(file.bytes).metadata();
  assert('512×512', avatarMeta.width === 512 && avatarMeta.height === 512);
  assert('EXIF с координатами выброшен', avatarMeta.exif === undefined);

  const second = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#fff' } }).png().toBuffer();
  r = await upload(playerToken, '/me/player/avatar', {}, { bytes: second, type: 'image/png', name: 'me.png' });
  check('аватар заменён', 200, r.status);
  const secondAvatarId = r.body?.avatarFileId;
  assert('новый файл — новый адрес', secondAvatarId && secondAvatarId !== avatarId);
  file = await download(null, avatarId);
  check('прежний аватар удалён вместе с заменой', 404, file.status);

  console.log('=== 30б. Достижения');
  r = await asPlayer('/me/player/achievements', {
    method: 'POST',
    json: { title: '  Первенство Красноярского края  ', date: '2025-04-12', level: 'REGIONAL', place: 2 },
  });
  check('достижение добавлено', 201, r.status);
  const achievementId = r.body?.achievements?.[0]?.id;
  assert('название без пробелов по краям', r.body?.achievements?.[0]?.title === 'Первенство Красноярского края');

  r = await asPlayer('/me/player/achievements', {
    method: 'POST',
    json: { title: 'Кубок клуба', date: '2026-02-01', level: 'CLUB' },
  });
  assert('без места — «участие», свежие сверху',
    r.body?.achievements?.[0]?.title === 'Кубок клуба' && r.body?.achievements?.[0]?.place === null);

  r = await asPlayer('/me/player/achievements', {
    method: 'POST',
    json: { title: 'Турнир', date: '2025-04-12', level: 'CITY', place: 0 },
  });
  check('нулевое место', 400, r.status);

  r = await asPlayer('/me/player/achievements', {
    method: 'POST',
    json: { title: 'Турнир', date: '2099-01-01', level: 'CITY' },
  });
  check('соревнование из будущего', 400, r.status);

  r = await as(outsiderToken)(`/me/player/achievements/${achievementId}`, {
    method: 'PATCH',
    json: { title: 'Чужое', date: '2025-04-12', level: 'CITY' },
  });
  check('чужое достижение не находится', 404, r.status);

  r = await asPlayer(`/me/player/achievements/${achievementId}`, {
    method: 'PATCH',
    json: { title: 'Первенство Красноярского края', date: '2025-04-12', level: 'REGIONAL', place: 1 },
  });
  check('своё достижение исправлено', 200, r.status);
  assert('место поправилось', r.body?.achievements?.some((a) => a.id === achievementId && a.place === 1));

  console.log('=== 30в. Разряд');
  r = await upload(playerToken, '/me/player/rank', { rank: 'KMS' });
  check('разряд без приказа и скана', 400, r.status);

  r = await upload(playerToken, '/me/player/rank', { rank: 'KMS', orderNumber: '45-нг' });
  check('номер приказа без даты', 400, r.status);

  r = await upload(playerToken, '/me/player/rank', { rank: 'ZMS', orderNumber: '45-нг', orderDate: '2024-11-01' });
  check('неизвестный разряд', 400, r.status);

  r = await upload(playerToken, '/me/player/rank', { rank: 'KMS', orderNumber: '45-нг', orderDate: '2099-11-01' });
  check('приказ из будущего', 400, r.status);

  r = await upload(playerToken, '/me/player/rank', { rank: 'KMS', orderNumber: '45-нг', orderDate: '2024-11-01' });
  check('разряд по приказу заявлен', 200, r.status);
  assert('разряд на проверке', r.body?.rank?.status === 'PENDING' && r.body?.rank?.reviewedBy === null);
  let version = r.body?.rank?.version;

  const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
  r = await upload(
    playerToken,
    '/me/player/rank',
    { rank: 'KMS', orderNumber: '45-нг', orderDate: '2024-11-01' },
    { bytes: pdf, type: 'application/pdf', name: 'prikaz.pdf' },
  );
  check('скан приказа приложен', 200, r.status);
  const documentId = r.body?.rank?.document?.id;
  assert('скан — PDF', r.body?.rank?.document?.contentType === 'application/pdf');
  version = r.body?.rank?.version;

  file = await download(null, documentId);
  check('скан приказа без входа', 403, file.status);
  file = await download(outsiderToken, documentId);
  check('скан приказа постороннему', 403, file.status);
  file = await download(minorToken, documentId);
  check('скан приказа другому клиенту того же клуба', 403, file.status);
  file = await download(playerToken, documentId);
  check('скан приказа владельцу', 200, file.status);
  assert('скан отдаётся вложением', /attachment/.test(file.headers.get('content-disposition') ?? ''));
  assert('закрытый файл не кешируется', /no-store/.test(file.headers.get('cache-control') ?? ''));
  assert('открытый напрямую — в песочнице', /sandbox/.test(file.headers.get('content-security-policy') ?? ''));
  file = await download(adminToken, documentId);
  check('скан приказа администратору клуба игрока', 200, file.status);

  console.log('=== 30г. Проверка разряда клубом');
  const reviewPath = `/clubs/yenisey/people/${playerId}/rank/review`;

  r = await as(minorToken)(reviewPath, { method: 'POST', json: { decision: 'VERIFIED', version } });
  check('клиент разряд не подтверждает', 403, r.status);

  r = await asAdmin(reviewPath, { method: 'POST', json: { decision: 'REJECTED', version } });
  check('отказ без причины', 400, r.status);

  r = await asAdmin(reviewPath, { method: 'POST', json: { decision: 'VERIFIED', version: '2020-01-01T00:00:00.000Z' } });
  check('решение по устаревшей версии', 409, r.status);

  r = await asAdmin(`/clubs/yenisey/people/${outsiderId}/rank/review`, {
    method: 'POST',
    json: { decision: 'VERIFIED', version },
  });
  check('разряд игрока другого клуба', 404, r.status);

  r = await asAdmin(reviewPath, { method: 'POST', json: { decision: 'VERIFIED', version } });
  check('разряд подтверждён', 200, r.status);
  assert('подпись клуба и проверяющего',
    r.body?.rank?.status === 'VERIFIED' && r.body?.rank?.reviewedBy?.clubSlug === 'yenisey' && typeof r.body?.rank?.reviewedBy?.by === 'string');
  const verifiedVersion = r.body?.rank?.version;

  r = await asAdmin(reviewPath, { method: 'POST', json: { decision: 'VERIFIED', version: verifiedVersion } });
  check('повторное подтверждение', 200, r.status);
  assert('ничего не изменило', r.body?.rank?.version === verifiedVersion);

  r = await call(`/players/${playerId}`);
  check('публичная страница без входа', 200, r.status);
  assert('имя сокращено', r.body?.name === 'Ракеткин И.');
  assert('ни почты, ни телефона, ни даты рождения',
    r.body && !('email' in r.body) && !('phone' in r.body) && !('birthDate' in r.body));
  assert('разряд с подписью клуба, без приказа',
    r.body?.rank?.status === 'VERIFIED' && typeof r.body?.rank?.verifiedBy?.clubName === 'string'
      && r.body?.rank?.verifiedBy?.by === undefined && !('orderNumber' in (r.body?.rank ?? {})));

  r = await upload(playerToken, '/me/player/rank', { rank: 'KMS', orderNumber: '45-нг', orderDate: '2024-11-01' });
  check('та же правка разряда ещё раз', 200, r.status);
  assert('подтверждение не сброшено', r.body?.rank?.status === 'VERIFIED');

  r = await upload(playerToken, '/me/player/rank', { rank: 'MS', orderNumber: '45-нг', orderDate: '2024-11-01' });
  check('разряд изменён игроком', 200, r.status);
  assert('подтверждение сброшено, подпись снята', r.body?.rank?.status === 'PENDING' && r.body?.rank?.reviewedBy === null);
  version = r.body?.rank?.version;

  r = await asAdmin(reviewPath, { method: 'POST', json: { decision: 'VERIFIED', version: verifiedVersion } });
  check('решение по разряду, который игрок успел поправить', 409, r.status);

  r = await asAdmin(reviewPath, {
    method: 'POST',
    json: { decision: 'REJECTED', reason: 'Приказ о КМС, а заявлен МС', version },
  });
  check('разряд отклонён с причиной', 200, r.status);
  assert('причина видна игроку', r.body?.rank?.rejectionReason === 'Приказ о КМС, а заявлен МС');
  version = r.body?.rank?.version;

  r = await asPlayer('/me/player');
  assert('игрок видит отказ у себя', r.body?.rank?.status === 'REJECTED');

  r = await call(`/players/${playerId}`);
  assert('отклонённый разряд посторонним не показывается', r.body?.rank === null);

  r = await asAdmin(reviewPath, { method: 'POST', json: { decision: 'VERIFIED', version } });
  check('пересмотр отказа без причины', 400, r.status);

  r = await asAdmin(reviewPath, {
    method: 'POST',
    json: { decision: 'VERIFIED', reason: 'Нашёлся приказ о МС', version },
  });
  check('пересмотр с причиной', 200, r.status);
  assert('разряд подтверждён, причины отказа нет', r.body?.rank?.status === 'VERIFIED' && r.body?.rank?.rejectionReason === null);

  r = await asAdmin(`/clubs/yenisey/people/${playerId}`);
  check('карточка человека с профилем игрока', 200, r.status);
  assert('в карточке разряд и скан', r.body?.player?.rank?.rank === 'MS' && r.body?.player?.rank?.document?.id === documentId);

  // Свой разряд: администратор «Енисея» играет в «Енисее» же.
  r = await upload(adminToken, '/me/player/rank', { rank: 'SPORT_1', orderNumber: 'смоук', orderDate: '2020-01-01' });
  check('администратор заявил свой разряд', 200, r.status);
  r = await asAdmin(`/clubs/yenisey/people/${adminId}/rank/review`, {
    method: 'POST',
    json: { decision: 'VERIFIED', version: r.body?.rank?.version },
  });
  check('свой разряд не подтверждается', 403, r.status);
  r = await asAdmin('/me/player/rank', { method: 'DELETE' });
  check('разряд администратора убран', 200, r.status);

  console.log('=== 30д. Игрок младше 16');
  const asMinor = as(minorToken);
  r = await asMinor('/me/player');
  assert('профиль ребёнка закрыт от посторонних', r.body?.isPublic === false);

  r = await upload(minorToken, '/me/player/avatar', {}, { bytes: second, type: 'image/png', name: 'kid.png' });
  check('до 16 профиль сам не правит — ведёт родитель', 403, r.status);

  // Игрок-взрослый закрепляет ребёнка за собой: заявка, подтверждение самим
  // ребёнком — и дальше ведёт его профиль параметром ?for=.
  r = await asPlayer('/me/children/attach', { method: 'POST', json: { email: minorEmail } });
  check('взрослый просит закрепить ребёнка', 200, r.status);
  r = await asMinor('/me/guardianship/requests');
  r = await asMinor(`/me/guardianship/requests/${r.body?.[0]?.id}/confirm`, { method: 'POST' });
  check('ребёнок подтвердил', 204, r.status);

  r = await upload(playerToken, `/me/player/avatar?for=${minorId}`, {}, { bytes: second, type: 'image/png', name: 'kid.png' });
  check('родитель загрузил аватар ребёнку', 200, r.status);
  const minorAvatar = r.body?.avatarFileId;

  r = await upload(outsiderToken, `/me/player/avatar?for=${minorId}`, {}, { bytes: second, type: 'image/png', name: 'kid.png' });
  check('посторонний профиль ребёнка не правит', 403, r.status);

  r = await call(`/players/${minorId}`);
  check('страница ребёнка без входа', 404, r.status);
  r = await as(outsiderToken)(`/players/${minorId}`);
  check('страница ребёнка постороннему', 404, r.status);
  r = await asPlayer(`/players/${minorId}`);
  check('страница ребёнка — его родителю', 200, r.status);
  r = await asMinor(`/players/${minorId}`);
  check('свою страницу ребёнок видит', 200, r.status);
  assert('с пометкой «скрыта от посторонних»', r.body?.hiddenFromPublic === true);
  r = await asAdmin(`/players/${minorId}`);
  check('администратору клуба ребёнка страница видна', 200, r.status);

  file = await download(null, minorAvatar);
  check('аватар ребёнка без входа', 403, file.status);
  file = await download(outsiderToken, minorAvatar);
  check('аватар ребёнка постороннему', 403, file.status);
  file = await download(adminToken, minorAvatar);
  check('аватар ребёнка администратору его клуба', 200, file.status);
  assert('и не кешируется', /no-store/.test(file.headers.get('cache-control') ?? ''));

  console.log('=== 30е. Удаление');
  r = await asPlayer('/me/player/avatar', { method: 'DELETE' });
  check('аватар убран', 200, r.status);
  assert('ссылки нет', r.body?.avatarFileId === null);
  file = await download(null, secondAvatarId);
  check('файл аватара удалён', 404, file.status);

  r = await asPlayer(`/me/player/achievements/${achievementId}`, { method: 'DELETE' });
  check('достижение удалено', 200, r.status);

  r = await asPlayer('/me/player/rank', { method: 'DELETE' });
  check('разряд удалён', 200, r.status);
  assert('разряда нет', r.body?.rank === null);
  file = await download(playerToken, documentId);
  check('скан приказа удалён вместе с разрядом', 404, file.status);

  r = await call('/players/net-takogo-igroka');
  check('несуществующий игрок', 404, r.status);
}

/**
 * Семья: родитель ведёт ребёнка младше 16.
 *
 * Даты рождения считаются от сегодняшнего дня: граница «ровно 16 лет» и
 * «ровно 18» должна проверяться в любой день прогона, а не в тот, когда секцию
 * писали.
 */
async function family() {
  const adminEmail = process.env.SMOKE_ADMIN_EMAIL;
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.log('\n=== 31. Семья — ПРОПУЩЕНА (нет учётки администратора)');
    return;
  }

  console.log('\n=== 31. Семья: учётка ребёнка, заявки, пароль, отвязка');

  /** Дата рождения того, кому `years` лет исполняется через `days` дней (0 — сегодня). */
  const bornYearsAgo = (years, days = 0) => {
    const now = new Date();
    const date = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate() + days));
    return date.toISOString().slice(0, 10);
  };

  const as = (token) => (path, options = {}) =>
    call(path, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) } });

  const newEmail = (tag) => `probe-${RUN}-${tag}-${Math.random().toString(36).slice(2, 6)}@example.com`;

  let r = await post('/auth/login', { email: adminEmail, password: adminPassword });
  const asAdmin = as(r.body?.accessToken ?? '');

  r = await post('/auth/register', registration({ lastName: 'Родителев', firstName: 'Олег' }));
  check('родитель заведён', 201, r.status);
  const parentToken = r.body?.accessToken ?? '';
  const asParent = as(parentToken);

  r = await post('/auth/register', registration({ lastName: 'Юнов', birthDate: bornYearsAgo(18, 1) }));
  check('семнадцатилетний заведён', 201, r.status);
  const asSeventeen = as(r.body?.accessToken ?? '');

  r = await post('/auth/register', registration({ lastName: 'Посторонний' }));
  const asStranger = as(r.body?.accessToken ?? '');

  // --- Учётка ребёнка из кабинета родителя.
  const childEmail = newEmail('kid');
  const childForm = (over = {}) => ({
    email: childEmail,
    password: PASSWORD,
    lastName: 'Родителев',
    firstName: 'Коля',
    middleName: 'Олегович',
    phone: '+79991234567',
    birthDate: bornYearsAgo(10),
    ...over,
  });

  r = await call('/me/children', { method: 'POST', json: childForm() });
  check('завести ребёнка без входа', 401, r.status);

  r = await asSeventeen('/me/children', { method: 'POST', json: childForm({ email: newEmail('kid17') }) });
  check('семнадцатилетний ребёнка не заводит', 403, r.status);

  r = await asParent('/me/children', {
    method: 'POST',
    json: childForm({ email: newEmail('kid16'), birthDate: bornYearsAgo(16) }),
  });
  check('шестнадцатилетнему учётка ребёнка не нужна', 400, r.status);

  r = await asParent('/me/children', { method: 'POST', json: childForm({ tenantSlug: 'yenisey' }) });
  check('клуб в форме ребёнка — лишнее поле', 400, r.status);

  r = await asParent('/me/children', { method: 'POST', json: childForm() });
  check('ребёнок заведён и закреплён сразу', 201, r.status);
  const childId = r.body?.id;
  assert('до какого дня опека', r.body?.guardianUntil === bornYearsAgo(10).replace(/^\d{4}/, (y) => String(Number(y) + 16)));

  r = await asParent('/me/children', { method: 'POST', json: childForm() });
  check('та же почта второй раз', 409, r.status);
  assert('подсказка про адрес с плюсом', String(r.body?.message ?? '').includes('+'));

  r = await post('/auth/login', { email: childEmail, password: PASSWORD });
  check('ребёнок входит своей учёткой', 200, r.status);
  const childToken = r.body?.accessToken ?? '';
  const childRefresh = r.body?.refreshToken ?? '';
  const asChild = as(childToken);

  r = await asChild('/me/guardianship');
  check('ребёнок видит, кто его ведёт', 200, r.status);
  assert('родитель — «Фамилия И.»', r.body?.name === 'Родителев О.');

  r = await asParent('/me/children');
  assert('ребёнок в списке родителя', (r.body ?? []).some((child) => child.id === childId));

  // --- Заявка на существующую учётку.
  const teenEmail = newEmail('teen');
  r = await post('/auth/register', registration({ email: teenEmail, lastName: 'Самостоятельный', birthDate: bornYearsAgo(12) }));
  check('ребёнок зарегистрировался сам', 201, r.status);
  const asTeen = as(r.body?.accessToken ?? '');

  r = await asStranger('/me/children/attach', { method: 'POST', json: { email: teenEmail } });
  check('посторонний отправил заявку', 200, r.status);
  const notice = r.body?.message;

  r = await asParent('/me/children/attach', { method: 'POST', json: { email: teenEmail.toUpperCase() } });
  check('родитель отправил заявку', 200, r.status);
  assert('ответ тот же', r.body?.message === notice);

  r = await asParent('/me/children/attach', { method: 'POST', json: { email: newEmail('nobody') } });
  assert('на несуществующую почту — тот же ответ', r.status === 200 && r.body?.message === notice);

  r = await asParent('/me/children/attach', { method: 'POST', json: { email: adminEmail } });
  assert('на взрослого — тот же ответ', r.status === 200 && r.body?.message === notice);

  r = await asSeventeen('/me/children/attach', { method: 'POST', json: { email: teenEmail } });
  check('семнадцатилетний заявку не отправляет', 403, r.status);

  r = await asTeen('/me/guardianship/requests');
  check('ребёнок видит заявки', 200, r.status);
  const requests = r.body ?? [];
  assert('две заявки — от родителя и постороннего', requests.length === 2);
  const parentRequest = requests.find((item) => item.guardianName === 'Родителев О.');

  r = await asParent(`/me/guardianship/requests/${parentRequest?.id}/confirm`, { method: 'POST' });
  check('родитель свою заявку подтвердить не может', 404, r.status);

  r = await asAdmin(`/me/guardianship/requests/${parentRequest?.id}/confirm`, { method: 'POST' });
  check('администратор подтвердить за ребёнка не может', 404, r.status);

  r = await asTeen(`/me/guardianship/requests/${parentRequest?.id}/confirm`, { method: 'POST' });
  check('ребёнок подтвердил заявку родителя', 204, r.status);

  r = await asTeen(`/me/guardianship/requests/${parentRequest?.id}/confirm`, { method: 'POST' });
  check('второе подтверждение', 409, r.status);

  r = await asTeen('/me/guardianship/requests');
  assert('заявка постороннего закрылась вместе с подтверждением', (r.body ?? []).length === 0);

  r = await asParent('/me/children');
  assert('у родителя двое детей', (r.body ?? []).length === 2);

  r = await asStranger('/me/children');
  assert('у постороннего — никого', (r.body ?? []).length === 0);

  // --- Пароль ребёнку.
  r = await asStranger(`/me/children/${childId}/password`, { method: 'POST', json: { password: 'novyi-parol-12345' } });
  check('посторонний пароль ребёнку не меняет', 404, r.status);

  r = await asParent(`/me/children/${childId}/password`, { method: 'POST', json: { password: 'korot7' } });
  check('слишком короткий пароль', 400, r.status);

  r = await asParent(`/me/children/${childId}/password`, { method: 'POST', json: { password: 'novyi-parol-12345' } });
  check('родитель сменил пароль ребёнку', 204, r.status);

  r = await post('/auth/refresh', { refreshToken: childRefresh });
  check('старая сессия ребёнка погашена', 401, r.status);

  r = await post('/auth/login', { email: childEmail, password: 'novyi-parol-12345' });
  check('ребёнок входит с новым паролем', 200, r.status);

  // --- Отвязка.
  r = await asChild(`/me/children/${childId}`, { method: 'DELETE' });
  check('ребёнок сам себя не отвязывает', 404, r.status);

  r = await asParent(`/me/children/${childId}`, { method: 'DELETE' });
  check('родитель отвязал ребёнка', 204, r.status);

  r = await asParent(`/me/children/${childId}`, { method: 'DELETE' });
  check('второй раз отвязывать некого', 404, r.status);

  r = await asChild('/me/guardianship');
  assert('у ребёнка больше нет родителя', r.status === 200 && r.body === null);

  console.log('=== 31б. Запись за ребёнка');

  // Заводим ребёнка заново: прежнего только что отвязали.
  const kidEmail = newEmail('kid2');
  r = await asParent('/me/children', { method: 'POST', json: childForm({ email: kidEmail, firstName: 'Петя' }) });
  check('второй ребёнок заведён', 201, r.status);
  const kidId = r.body?.id;
  r = await post('/auth/login', { email: kidEmail, password: PASSWORD });
  const asKid = as(r.body?.accessToken ?? '');

  r = await asAdmin('/clubs/yenisey/coaches');
  const coachId = r.body?.[0]?.id;
  r = await asAdmin('/clubs/yenisey/training-types');
  const trainingTypeId = r.body?.[0]?.id;
  r = await asAdmin('/clubs/yenisey/tournament-types');
  const tournamentTypeId = r.body?.[0]?.id;

  const soon = new Date(Date.now() + 9 * 24 * 3600_000);
  const later = new Date(soon.getTime() + 90 * 60_000);

  r = await asAdmin('/clubs/yenisey/tournaments', {
    method: 'POST',
    json: { tournamentTypeId, startsAt: soon.toISOString(), endsAt: later.toISOString() },
  });
  check('турнир для семьи заведён', 201, r.status);
  const cupId = r.body?.id;

  r = await asAdmin('/clubs/yenisey/training-sessions', {
    method: 'POST',
    json: { trainingTypeId, coachId, startsAt: soon.toISOString(), endsAt: later.toISOString(), capacity: 5 },
  });
  check('занятие для семьи заведено', 201, r.status);
  const sessionId = r.body?.id;

  r = await asKid(`/clubs/yenisey/tournaments/${cupId}/registration`, { method: 'POST' });
  check('ребёнок сам на турнир не записывается', 403, r.status);
  assert('и знает почему', String(r.body?.message ?? '').includes('родитель'));

  r = await asKid(`/clubs/yenisey/tournaments/${cupId}/registration?for=${kidId}`, { method: 'POST' });
  check('и «за себя» через for — тоже', 403, r.status);

  r = await asStranger(`/clubs/yenisey/tournaments/${cupId}/registration?for=${kidId}`, { method: 'POST' });
  check('посторонний за чужого ребёнка не записывает', 403, r.status);

  r = await asParent(`/clubs/yenisey/tournaments/${cupId}/registration?for=${kidId}`, { method: 'POST' });
  check('родитель записал ребёнка на турнир', 201, r.status);

  r = await asParent(`/clubs/yenisey/trainings/${sessionId}/booking?for=${kidId}`, { method: 'POST' });
  check('родитель записал ребёнка на занятие', 201, r.status);

  // Ребёнок в окне мероприятия — инициалами: ни ссылки на закрытый профиль,
  // ни фотографии. Одинаково для всех, даже для его родителя.
  r = await asParent(`/clubs/yenisey/events/tournament/${cupId}`);
  const kidCircle = (r.body?.people ?? []).find((person) => person.userId === null);
  assert('ребёнок в окне — без ссылки и фотографии', kidCircle !== undefined && kidCircle.avatarFileId === null);
  assert('идентификатор ребёнка в окно не ушёл', !(r.body?.people ?? []).some((person) => person.userId === kidId));

  r = await asKid('/me/bookings');
  check('ребёнок видит свои записи', 200, r.status);
  assert('обе записи — у ребёнка', (r.body ?? []).filter((e) => e.id === cupId || e.id === sessionId).length === 2);

  r = await asParent('/me/bookings');
  assert('у родителя в своих записях их нет', !(r.body ?? []).some((e) => e.id === cupId || e.id === sessionId));

  r = await asParent(`/me/bookings?for=${kidId}`);
  assert('родитель видит записи ребёнка', (r.body ?? []).filter((e) => e.id === cupId || e.id === sessionId).length === 2);

  r = await asStranger(`/me/bookings?for=${kidId}`);
  check('посторонний записей ребёнка не видит', 403, r.status);

  r = await call(`/clubs/yenisey/events?for=${kidId}`);
  check('за ребёнка без входа не смотрят', 401, r.status);

  r = await asParent(`/clubs/yenisey/events?for=${kidId}`);
  assert('в списке клуба отметка «записан» — за ребёнка',
    (r.body ?? []).find((event) => event.id === cupId)?.registered === true);

  r = await asParent('/clubs/yenisey/events');
  assert('а за самого родителя — «не записан»',
    (r.body ?? []).find((event) => event.id === cupId)?.registered === false);

  r = await asKid(`/clubs/yenisey/tournaments/${cupId}/registration`, { method: 'DELETE' });
  check('ребёнок сам не отменяет', 403, r.status);

  r = await asParent(`/clubs/yenisey/tournaments/${cupId}/registration?for=${kidId}`, { method: 'DELETE' });
  check('родитель отменил запись ребёнка', 200, r.status);

  // --- Родитель — тренер клуба: пишет ребёнка как обычный родитель.
  r = await post('/auth/register', registration({ lastName: 'Тренеров', firstName: 'Папа' }));
  const coachParentId = r.body?.user?.id;
  const asCoachParent = as(r.body?.accessToken ?? '');
  r = await asAdmin(`/clubs/yenisey/people/${coachParentId}/role`, { method: 'PATCH', json: { role: 'COACH' } });
  check('родитель стал тренером клуба', 200, r.status);

  r = await asCoachParent('/me/children', { method: 'POST', json: childForm({ email: newEmail('coachkid'), lastName: 'Тренеров' }) });
  check('тренер завёл ребёнка', 201, r.status);
  const coachKidId = r.body?.id;

  r = await asCoachParent(`/clubs/yenisey/tournaments/${cupId}/registration`, { method: 'POST' });
  check('сам тренер клиентом не записывается', 403, r.status);

  r = await asCoachParent(`/clubs/yenisey/tournaments/${cupId}/registration?for=${coachKidId}`, { method: 'POST' });
  check('а ребёнка записывает как обычный родитель', 201, r.status);

  // --- Граница 16 лет у самостоятельной записи.
  r = await post('/auth/register', registration({ lastName: 'Именинник', birthDate: bornYearsAgo(16) }));
  const asBirthday = as(r.body?.accessToken ?? '');
  r = await asBirthday(`/clubs/yenisey/tournaments/${cupId}/registration`, { method: 'POST' });
  check('в день шестнадцатилетия записывается сам', 201, r.status);

  r = await post('/auth/register', registration({ lastName: 'Почтиименинник', birthDate: bornYearsAgo(16, 1) }));
  const asAlmost = as(r.body?.accessToken ?? '');
  r = await asAlmost(`/clubs/yenisey/tournaments/${cupId}/registration`, { method: 'POST' });
  check('накануне — ещё нет', 403, r.status);

  // --- Профиль игрока ребёнка ведёт родитель.
  r = await asKid('/me/player');
  check('ребёнок смотрит свой профиль', 200, r.status);

  r = await asKid('/me/player', { method: 'PATCH', json: { blade: 'Детское' } });
  check('ребёнок сам профиль не правит', 403, r.status);

  r = await asParent(`/me/player?for=${kidId}`, { method: 'PATCH', json: { blade: 'Детское основание' } });
  check('родитель ведёт профиль ребёнка', 200, r.status);
  assert('правка легла ребёнку', r.body?.userId === kidId && r.body?.equipment?.blade === 'Детское основание');

  r = await asStranger(`/me/player?for=${kidId}`);
  check('посторонний профиль ребёнка не читает', 403, r.status);

  const scanForm = new FormData();
  scanForm.set('rank', 'YOUTH_1');
  scanForm.set('file', new Blob([new TextEncoder().encode('%PDF-1.4\n%%EOF\n')], { type: 'application/pdf' }), 'prikaz.pdf');
  const scanResponse = await fetch(`${API}/me/player/rank?for=${kidId}`, {
    method: 'PUT',
    body: scanForm,
    headers: { Authorization: `Bearer ${parentToken}` },
  });
  check('родитель заявил разряд ребёнка со сканом', 200, scanResponse.status);
  const scanId = (await scanResponse.json())?.rank?.document?.id;

  r = await asParent(`/files/${scanId}`);
  check('родитель видит скан приказа ребёнка', 200, r.status);
  r = await asStranger(`/files/${scanId}`);
  check('посторонний — нет', 403, r.status);

  r = await asParent(`/players/${kidId}`);
  check('страница ребёнка открыта родителю', 200, r.status);
  r = await asStranger(`/players/${kidId}`);
  check('и закрыта постороннему', 404, r.status);

  // --- После отвязки ребёнок младше 16 по-прежнему не записывается сам.
  r = await asParent(`/me/children/${kidId}`, { method: 'DELETE' });
  check('родитель отвязал второго ребёнка', 204, r.status);
  r = await asParent(`/clubs/yenisey/trainings/${sessionId}/booking?for=${kidId}`, { method: 'POST' });
  check('отвязанного больше не записывает', 403, r.status);
  r = await asKid(`/clubs/yenisey/tournaments/${cupId}/registration`, { method: 'POST' });
  check('а сам он до 16 по-прежнему не записывается', 403, r.status);

  console.log('=== 31в. Семья у стойки');

  // Родитель-клиент «Енисея» — registration() регистрирует со страницы клуба.
  r = await post('/auth/register', registration({ lastName: 'Стойкин', firstName: 'Андрей' }));
  const deskParentId = r.body?.user?.id;
  const asDeskParent = as(r.body?.accessToken ?? '');

  r = await post('/auth/register', registration({ tenantSlug: undefined, lastName: 'Чужаков' }));
  const outsiderParentId = r.body?.user?.id;

  r = await post('/auth/register', registration({ lastName: 'Молодой', birthDate: bornYearsAgo(18, 1) }));
  const youngParentId = r.body?.user?.id;

  const deskChildEmail = newEmail('deskkid');
  const deskChild = childForm({ email: deskChildEmail, lastName: 'Стойкин', firstName: 'Ваня', middleName: 'Андреевич' });

  r = await asDeskParent(`/clubs/yenisey/people/${deskParentId}/children`, { method: 'POST', json: deskChild });
  check('клиент ребёнка у стойки не заводит', 403, r.status);

  r = await asAdmin(`/clubs/yenisey/people/${outsiderParentId}/children`, { method: 'POST', json: deskChild });
  check('родителю не из клуба — не заводит', 404, r.status);

  r = await asAdmin(`/clubs/yenisey/people/${youngParentId}/children`, { method: 'POST', json: deskChild });
  check('семнадцатилетнему родителю — не заводит', 403, r.status);

  r = await asAdmin(`/clubs/sayany/people/${deskParentId}/children`, { method: 'POST', json: deskChild });
  check('администратор чужого клуба — не заводит', 403, r.status);

  r = await asAdmin(`/clubs/yenisey/people/${deskParentId}/children`, { method: 'POST', json: deskChild });
  check('администратор завёл ребёнка родителю у стойки', 201, r.status);
  const deskChildId = r.body?.id;

  r = await post('/auth/login', { email: deskChildEmail, password: PASSWORD });
  check('ребёнок входит паролем, который задал родитель', 200, r.status);
  const asDeskChild = as(r.body?.accessToken ?? '');

  r = await asAdmin(`/clubs/yenisey/people/${deskChildId}`);
  check('ребёнок сразу в клубе — карточка открывается', 200, r.status);
  assert('в карточке ребёнка — родитель', r.body?.family?.isChild === true && r.body?.family?.guardian?.id === deskParentId);

  r = await asAdmin(`/clubs/yenisey/people/${deskParentId}`);
  assert('в карточке родителя — ребёнок', (r.body?.family?.children ?? []).some((child) => child.id === deskChildId));

  r = await asDeskParent('/me/children');
  assert('и у родителя в кабинете', (r.body ?? []).some((child) => child.id === deskChildId));

  // --- Снять закрепление от имени клуба.
  r = await asAdmin(`/clubs/yenisey/people/${deskChildId}/guardian/revoke`, { method: 'POST', json: { reason: '' } });
  check('без причины — нельзя', 400, r.status);

  r = await asAdmin(`/clubs/yenisey/people/${deskChildId}/guardian/revoke`, { method: 'POST', json: { reason: '   ' } });
  check('из одних пробелов — тоже', 400, r.status);

  r = await asDeskParent(`/clubs/yenisey/people/${deskChildId}/guardian/revoke`, { method: 'POST', json: { reason: 'Хочу' } });
  check('клиент от имени клуба не снимает', 403, r.status);

  r = await asAdmin(`/clubs/yenisey/people/${deskChildId}/guardian/revoke`, {
    method: 'POST',
    json: { reason: 'Родитель потерял доступ к учётке' },
  });
  check('клуб снял закрепление с причиной', 204, r.status);

  r = await asAdmin(`/clubs/yenisey/people/${deskChildId}/guardian/revoke`, {
    method: 'POST',
    json: { reason: 'Ещё раз' },
  });
  check('снятое второй раз не снимается', 404, r.status);

  r = await asAdmin(`/clubs/yenisey/people/${deskChildId}`);
  assert('у ребёнка больше нет родителя', r.body?.family?.guardian === null);

  // --- Заявка от администратора: подтверждает ребёнок.
  r = await asAdmin(`/clubs/yenisey/people/${deskChildId}/guardian`, { method: 'POST', json: { guardianId: youngParentId } });
  check('семнадцатилетнему заявку не предлагают', 400, r.status);

  r = await asAdmin(`/clubs/yenisey/people/${deskChildId}/guardian`, { method: 'POST', json: { guardianId: outsiderParentId } });
  check('родителю не из клуба — не предлагают', 404, r.status);

  r = await asAdmin(`/clubs/yenisey/people/${deskChildId}/guardian`, { method: 'POST', json: { guardianId: deskParentId } });
  check('администратор предложил закрепить', 204, r.status);

  r = await asAdmin(`/clubs/yenisey/people/${deskChildId}/guardian`, { method: 'POST', json: { guardianId: deskParentId } });
  check('повторное предложение — то же состояние', 204, r.status);

  r = await asAdmin(`/clubs/yenisey/people/${deskChildId}`);
  assert('до подтверждения ребёнок не закреплён', r.body?.family?.guardian === null);

  r = await asDeskChild('/me/guardianship/requests');
  const deskRequest = (r.body ?? [])[0];
  assert('ребёнок видит одну заявку от родителя', (r.body ?? []).length === 1 && deskRequest?.guardianName === 'Стойкин А.');

  r = await asAdmin(`/me/guardianship/requests/${deskRequest?.id}/confirm`, { method: 'POST' });
  check('администратор за ребёнка не подтверждает', 404, r.status);

  r = await asDeskChild(`/me/guardianship/requests/${deskRequest?.id}/confirm`, { method: 'POST' });
  check('ребёнок подтвердил', 204, r.status);

  r = await asAdmin(`/clubs/yenisey/people/${deskChildId}/guardian`, { method: 'POST', json: { guardianId: deskParentId } });
  check('уже закреплённому — не предлагают', 409, r.status);

  r = await asAdmin(`/clubs/yenisey/people/${deskParentId}`);
  assert('ребёнок снова в карточке родителя', (r.body?.family?.children ?? []).some((child) => child.id === deskChildId));

  r = await asAdmin(`/clubs/yenisey/people/${youngParentId}`);
  assert('семнадцатилетний — не ребёнок и не родитель', r.body?.family?.isChild === false && r.body?.family?.canBeGuardian === false);
}

/**
 * Уведомления в MAX: привязка через бота, проверочное сообщение, категории,
 * остановка бота и перенос привязки.
 *
 * Идёт через поддельный MAX (маршруты /dev/max): смоук присылает боту те же
 * события, что прислал бы MAX, и читает, что бот ответил. На API с настоящим
 * ботом или в production этих маршрутов нет — раздел пропускается.
 */
async function notifications() {
  let r = await call('/dev/max/sent?maxUserId=0');

  if (r.status !== 200) {
    console.log('\n=== 35. Уведомления в MAX — ПРОПУЩЕНЫ (нет поддельного MAX: API с ботом или production)');
    return;
  }

  console.log('\n=== 35. Уведомления в MAX');

  const as = (token) => (path, options = {}) =>
    call(path, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) } });
  const event = (json) => call('/dev/max/events', { method: 'POST', json });
  const user = (id) => ({ user_id: id, first_name: 'Проба', name: 'Проба', username: null, is_bot: false, last_activity_time: 0 });
  const sentTo = async (id) => (await call(`/dev/max/sent?maxUserId=${id}`)).body ?? [];
  const lastTo = async (id) => (await sentTo(id)).at(-1)?.text ?? '';
  const tokenOf = (url) => new URL(url).searchParams.get('start') ?? '';
  // Уникальные на прогон идентификаторы MAX: прошлые прогоны оставляют привязки.
  const maxIdA = (RUN % 1_000_000_000) * 10 + 1;
  const maxIdB = maxIdA + 1;

  r = await call('/me/notifications');
  check('настройки без входа закрыты', 401, r.status);

  r = await post('/auth/register', registration({ lastName: 'Максимов' }));
  const asA = as(r.body?.accessToken ?? '');

  r = await asA('/me/notifications');
  check('настройки уведомлений читаются', 200, r.status);
  assert('MAX доступен и ещё не подключён', r.body?.max?.available === true && r.body?.max?.linked === false);
  assert(
    'клиенту — только свои записи и абонемент',
    JSON.stringify(r.body?.categories?.map((item) => item.category)) === JSON.stringify(['MY_BOOKINGS', 'MY_SUBSCRIPTION']),
  );

  r = await asA('/me/notifications/test', { method: 'POST' });
  check('проверочное без привязки — 409', 409, r.status);

  r = await asA('/me/notifications/max', { method: 'POST' });
  check('ссылка привязки выдана', 201, r.status);
  const tokenA = tokenOf(r.body?.url ?? 'https://x.invalid');
  assert('в ссылке токен для start', /^[A-Za-z0-9_-]{32}$/.test(tokenA));

  await event({ update_type: 'bot_started', timestamp: Date.now(), chat_id: 1, user: user(maxIdA), payload: tokenA });
  assert('бот подтвердил привязку сокращённым именем', /Готово.*Максимов П\./s.test(await lastTo(maxIdA)));

  r = await asA('/me/notifications');
  assert('на сайте MAX подключён', r.body?.max?.linked === true && r.body?.max?.blocked === false);

  // Та же ссылка второй раз — уже с другого MAX: токен одноразовый.
  await event({ update_type: 'bot_started', timestamp: Date.now(), chat_id: 2, user: user(maxIdB), payload: tokenA });
  assert('повтор ссылки отвергнут', /устарела или уже использована/.test(await lastTo(maxIdB)));

  // --- Проверочное сообщение: очередь → отправщик → MAX.
  r = await asA('/me/notifications/test', { method: 'POST' });
  check('проверочное встало в очередь', 204, r.status);
  r = await asA('/me/notifications/test', { method: 'POST' });
  check('второе в ту же минуту — 429', 429, r.status);

  r = await call('/dev/max/dispatch', { method: 'POST' });
  check('отправщик прошёл', 201, r.status);
  assert('проверочное дошло до MAX', /Проверка связи/.test(await lastTo(maxIdA)));

  // --- Категории.
  r = await asA('/me/notifications/categories/MY_BOOKINGS', { method: 'PUT', json: { enabled: false } });
  check('категория выключается', 200, r.status);
  assert(
    'и остаётся выключенной',
    r.body?.categories?.find((item) => item.category === 'MY_BOOKINGS')?.enabled === false,
  );
  r = await asA('/me/notifications/categories/CLUB_DIGEST', { method: 'PUT', json: { enabled: false } });
  check('чужая по ролям категория — 400', 400, r.status);
  r = await asA('/me/notifications/categories/SERVICE', { method: 'PUT', json: { enabled: false } });
  check('служебное не выключается — 400', 400, r.status);
  r = await asA('/me/notifications/categories/MY_BOOKINGS', { method: 'PUT', json: { enabled: 'нет' } });
  check('не булево — 400', 400, r.status);

  // --- Остановка бота и возвращение.
  await event({ update_type: 'bot_stopped', timestamp: Date.now(), chat_id: 1, user: user(maxIdA) });
  r = await asA('/me/notifications');
  assert('остановленный бот виден на сайте', r.body?.max?.blocked === true);
  r = await asA('/me/notifications/test', { method: 'POST' });
  check('проверочное остановленному — 409', 409, r.status);

  await event({ update_type: 'bot_started', timestamp: Date.now(), chat_id: 1, user: user(maxIdA), payload: null });
  assert('запуск без ссылки возвращает уведомления', /снова включены/.test(await lastTo(maxIdA)));
  r = await asA('/me/notifications');
  assert('и на сайте тоже', r.body?.max?.blocked === false && r.body?.max?.linked === true);

  // --- Тот же MAX привязывает вторая учётка: первая его теряет.
  r = await post('/auth/register', registration({ lastName: 'Второва' }));
  const asB = as(r.body?.accessToken ?? '');
  r = await asB('/me/notifications/max', { method: 'POST' });
  await event({ update_type: 'bot_started', timestamp: Date.now(), chat_id: 1, user: user(maxIdA), payload: tokenOf(r.body?.url ?? 'https://x.invalid') });
  assert('бот предупредил о переносе привязки', /к другой учётке/.test(await lastTo(maxIdA)));
  r = await asA('/me/notifications');
  assert('первая учётка отвязана', r.body?.max?.linked === false);

  // --- /stop в диалоге снимает привязку.
  await event({
    update_type: 'message_created',
    timestamp: Date.now(),
    message: {
      sender: user(maxIdA),
      recipient: { chat_id: 1, chat_type: 'dialog', user_id: null, post_id: null },
      timestamp: Date.now(),
      body: { mid: 'm', seq: 1, text: '/stop' },
    },
  });
  assert('бот подтвердил отключение', /Уведомления отключены/.test(await lastTo(maxIdA)));
  r = await asB('/me/notifications');
  assert('вторая учётка отвязана командой', r.body?.max?.linked === false);

  // --- MAX отказал в отправке (бота остановили, а событие не дошло).
  r = await asB('/me/notifications/max', { method: 'POST' });
  await event({ update_type: 'bot_started', timestamp: Date.now(), chat_id: 2, user: user(maxIdB), payload: tokenOf(r.body?.url ?? 'https://x.invalid') });
  await call('/dev/max/stopped', { method: 'POST', json: { maxUserId: String(maxIdB) } });
  r = await asB('/me/notifications/test', { method: 'POST' });
  check('проверочное встало', 204, r.status);
  await call('/dev/max/dispatch', { method: 'POST' });
  r = await asB('/me/notifications');
  assert('отказ MAX помечает бота остановленным', r.body?.max?.blocked === true);

  r = await call('/max/webhook', { method: 'POST', json: { update_type: 'bot_started' } });
  check('вебхук без секрета не отвечает', 404, r.status);
}

/**
 * Сообщения клиенту в MAX: подтверждение записи, напоминание, отмена,
 * напоминание об отменённой записи, заявка родителя и запись ребёнка родителем.
 *
 * Напоминание за три часа смоук не ждёт: планировщик запускается отладочным
 * маршрутом с подставным «сейчас». Неявка, абонемент и разряд покрыты
 * юнит-тестами текстов и правил: дождаться начала занятия в пределах прогона
 * нельзя, а остальное требует долгой подготовки ради одной строки вызова.
 */
async function clientNotifications() {
  const adminEmail = process.env.SMOKE_ADMIN_EMAIL;
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD;
  let r = await call('/dev/max/sent?maxUserId=0');

  if (r.status !== 200 || !adminEmail || !adminPassword) {
    console.log('\n=== 36. Сообщения клиенту в MAX — ПРОПУЩЕНЫ (нет поддельного MAX или нет учётки администратора)');
    return;
  }

  console.log('\n=== 36. Сообщения клиенту в MAX');

  const as = (token) => (path, options = {}) =>
    call(path, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) } });
  const user = (id) => ({ user_id: id, first_name: 'Проба', name: 'Проба', username: null, is_bot: false, last_activity_time: 0 });
  const sentTo = async (id) => (await call(`/dev/max/sent?maxUserId=${id}`)).body ?? [];
  const lastTo = async (id) => (await sentTo(id)).at(-1)?.text ?? '';
  const dispatch = () => call('/dev/max/dispatch', { method: 'POST' });
  const schedule = (now) => call('/dev/max/schedule', { method: 'POST', json: { now: now.toISOString(), parts: ['clients'] } });
  const bornYearsAgo = (years) => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
  };

  /** Завести учётку, привязать ей поддельный MAX и вернуть её доступ. */
  const linked = async (maxId, overrides) => {
    const form = registration(overrides);
    let reply = await post('/auth/register', form);
    const asUser = as(reply.body?.accessToken ?? '');
    reply = await asUser('/me/notifications/max', { method: 'POST' });
    const token = new URL(reply.body?.url ?? 'https://x.invalid').searchParams.get('start');
    await call('/dev/max/events', {
      method: 'POST',
      json: { update_type: 'bot_started', timestamp: Date.now(), chat_id: maxId, user: user(maxId), payload: token },
    });
    return { asUser, email: form.email };
  };

  const base = (RUN % 1_000_000_000) * 10 + 5;
  const maxClient = base;
  const maxTeen = base + 1;
  const maxParent = base + 2;

  // --- Занятие через три дня в 18:00 по Красноярску: напоминание в 15:00, не в тихие часы.
  r = await post('/auth/login', { email: adminEmail, password: adminPassword });
  const asAdmin = as(r.body?.accessToken ?? '');
  const coachId = (await asAdmin('/clubs/yenisey/coaches')).body?.[0]?.id;
  const trainingType = (await asAdmin('/clubs/yenisey/training-types')).body?.[0];

  if (!coachId || !trainingType) {
    console.log('     в клубе нет тренера или типа тренировки — сценарий пропущен');
    return;
  }

  const startsAt = new Date(instantAt(dateIn('Asia/Krasnoyarsk', 3), 18 * 60, 'Asia/Krasnoyarsk'));
  r = await asAdmin('/clubs/yenisey/training-sessions', {
    method: 'POST',
    json: {
      trainingTypeId: trainingType.id,
      coachId,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 90 * 60_000).toISOString(),
      capacity: 5,
    },
  });
  check('занятие для сообщений заведено', 201, r.status);
  const sessionId = r.body?.id;
  const booking = `/clubs/yenisey/trainings/${sessionId}/booking`;

  const client = await linked(maxClient, { lastName: 'Записанов' });

  // --- Подтверждение.
  r = await client.asUser(booking, { method: 'POST' });
  check('клиент записался', 201, r.status);
  await dispatch();
  let text = await lastTo(maxClient);
  assert('пришло подтверждение записи', /^Вы записаны/.test(text));
  assert('в нём занятие и время по поясу зала', text.includes(`Занятие «${trainingType.name}»`) && text.includes('18:00'));

  // --- Напоминание за три часа.
  r = await schedule(new Date(startsAt.getTime() - 3 * 3_600_000 + 60_000));
  check('планировщик прошёл', 201, r.status);
  await dispatch();
  text = await lastTo(maxClient);
  assert('пришло напоминание', /^Напоминание о записи/.test(text));
  assert('с бесплатной отменой до 17:00', /до 17:00/.test(text));

  r = await schedule(new Date(startsAt.getTime() - 3 * 3_600_000 + 120_000));
  await dispatch();
  assert(
    'второй проход планировщика напоминание не повторяет',
    (await sentTo(maxClient)).filter((message) => message.text.startsWith('Напоминание')).length === 1,
  );

  // --- Отмена.
  r = await client.asUser(booking, { method: 'DELETE' });
  check('клиент отменил запись', 200, r.status);
  await dispatch();
  text = await lastTo(maxClient);
  assert('пришло сообщение об отмене', /^Запись отменена/.test(text) && /Бесплатно: отмена в срок/.test(text));

  // --- Напоминание, которое встало в очередь, а запись тут же отменили.
  r = await client.asUser(booking, { method: 'POST' });
  check('клиент записался снова', 201, r.status);
  await dispatch();
  await schedule(new Date(startsAt.getTime() - 3 * 3_600_000 + 60_000));
  await client.asUser(booking, { method: 'DELETE' });
  await dispatch();
  assert(
    'напоминание об отменённой записи не ушло',
    (await sentTo(maxClient)).filter((message) => message.text.startsWith('Напоминание')).length === 1,
  );

  // --- Семья: заявка родителя и запись ребёнка родителем.
  const teen = await linked(maxTeen, { lastName: 'Детков', firstName: 'Коля', birthDate: bornYearsAgo(12) });
  const parent = await linked(maxParent, { lastName: 'Детков', firstName: 'Олег', birthDate: bornYearsAgo(40) });

  r = await parent.asUser('/me/children/attach', { method: 'POST', json: { email: teen.email } });
  check('родитель подал заявку', 200, r.status);
  await dispatch();
  assert('ребёнку пришла заявка родителя', /^Детков О\. просит закрепить вас/.test(await lastTo(maxTeen)));

  r = await teen.asUser('/me/guardianship/requests');
  r = await teen.asUser(`/me/guardianship/requests/${r.body?.[0]?.id}/confirm`, { method: 'POST' });
  const teenId = (await teen.asUser('/auth/me')).body?.id;

  r = await parent.asUser(`${booking}?for=${teenId}`, { method: 'POST' });
  check('родитель записал ребёнка', 201, r.status);
  await dispatch();
  assert('родителю — с именем ребёнка', /^Новая запись · Детков К\./.test(await lastTo(maxParent)));
  assert('ребёнку — о своей записи', /^Вы записаны/.test(await lastTo(maxTeen)));

  r = await parent.asUser(`${booking}?for=${teenId}`, { method: 'DELETE' });
  await dispatch();
  assert('об отмене узнали оба', /^Запись отменена · Детков К\./.test(await lastTo(maxParent)) && /^Запись отменена/.test(await lastTo(maxTeen)));
}

/**
 * Сообщения персоналу в MAX: тренеру — запись и отмена в его группе и план на
 * день, администраторам — разряд на проверку и неотмеченное присутствие.
 *
 * Эскалация идёт на занятии длиной в несколько секунд и со сроком
 * напоминания клуба, опущенным до нуля: иначе её пришлось бы ждать час.
 * Настройки клуба раздел возвращает.
 */
async function staffNotifications() {
  const adminEmail = process.env.SMOKE_ADMIN_EMAIL;
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD;
  let r = await call('/dev/max/sent?maxUserId=0');

  if (r.status !== 200 || !adminEmail || !adminPassword) {
    console.log('\n=== 37. Сообщения персоналу в MAX — ПРОПУЩЕНЫ (нет поддельного MAX или нет учётки администратора)');
    return;
  }

  console.log('\n=== 37. Сообщения персоналу в MAX');

  const as = (token) => (path, options = {}) =>
    call(path, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) } });
  const user = (id) => ({ user_id: id, first_name: 'Проба', name: 'Проба', username: null, is_bot: false, last_activity_time: 0 });
  const sentTo = async (id) => (await call(`/dev/max/sent?maxUserId=${id}`)).body ?? [];
  const lastTo = async (id) => (await sentTo(id)).at(-1)?.text ?? '';
  const dispatch = () => call('/dev/max/dispatch', { method: 'POST' });
  const schedule = (now, parts) => call('/dev/max/schedule', { method: 'POST', json: { now: now.toISOString(), parts } });
  const linkMax = async (asUser, maxId) => {
    const reply = await asUser('/me/notifications/max', { method: 'POST' });
    const token = new URL(reply.body?.url ?? 'https://x.invalid').searchParams.get('start');
    await call('/dev/max/events', {
      method: 'POST',
      json: { update_type: 'bot_started', timestamp: Date.now(), chat_id: maxId, user: user(maxId), payload: token },
    });
  };

  const base = (RUN % 1_000_000_000) * 10 + 7;
  const maxAdmin = base;
  const maxCoach = base + 1;

  r = await post('/auth/login', { email: adminEmail, password: adminPassword });
  const asAdmin = as(r.body?.accessToken ?? '');
  await linkMax(asAdmin, maxAdmin);

  r = await asAdmin('/me/notifications');
  assert(
    'администратору доступны дела клуба',
    r.body?.categories?.some((item) => item.category === 'CLUB_ALERTS'),
  );

  // --- Пробный тренер со своим MAX.
  r = await post('/auth/register', registration({ lastName: 'Тренеров', firstName: 'Игнат' }));
  const coachId = r.body?.user?.id;
  const asCoach = as(r.body?.accessToken ?? '');
  r = await asAdmin(`/clubs/yenisey/people/${coachId}/role`, { method: 'PATCH', json: { role: 'COACH' } });
  check('пробному тренеру выдана роль', 200, r.status);
  await linkMax(asCoach, maxCoach);

  r = await asCoach('/me/notifications');
  assert('тренеру доступны «Мои группы»', r.body?.categories?.some((item) => item.category === 'COACH_GROUPS'));

  const trainingType = (await asAdmin('/clubs/yenisey/training-types')).body?.[0];
  const startsAt = new Date(instantAt(dateIn('Asia/Krasnoyarsk', 3), 18 * 60, 'Asia/Krasnoyarsk'));
  r = await asAdmin('/clubs/yenisey/training-sessions', {
    method: 'POST',
    json: {
      trainingTypeId: trainingType?.id,
      coachId,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 90 * 60_000).toISOString(),
      capacity: 5,
    },
  });
  check('занятие пробного тренера заведено', 201, r.status);
  const booking = `/clubs/yenisey/trainings/${r.body?.id}/booking`;

  r = await post('/auth/register', registration({ lastName: 'Ученикова', firstName: 'Анна' }));
  const asPupil = as(r.body?.accessToken ?? '');
  const pupilToken = r.body?.accessToken ?? '';

  // --- Тренеру: запись и отмена в группе.
  r = await asPupil(booking, { method: 'POST' });
  check('ученица записалась', 201, r.status);
  await dispatch();
  let text = await lastTo(maxCoach);
  assert('тренеру пришла запись в группу', /^Запись в группу · Ученикова А\./.test(text));
  assert('с числом занятых мест', /Записано 1 из 5\./.test(text));

  r = await asPupil(booking, { method: 'DELETE' });
  await dispatch();
  text = await lastTo(maxCoach);
  assert('тренеру пришла отмена', /^Отмена в группе · Ученикова А\./.test(text) && /Записано 0 из 5\./.test(text));

  // --- Тренеру утром: план на день.
  await asPupil(booking, { method: 'POST' });
  const morning = new Date(instantAt(dateIn('Asia/Krasnoyarsk', 3), 8 * 60 + 5, 'Asia/Krasnoyarsk'));
  await schedule(morning, ['coachPlans']);
  await schedule(morning, ['coachPlans']);
  await dispatch();
  text = await lastTo(maxCoach);
  assert('тренеру утром пришёл план', /^Сегодня у вас/.test(text) && /18:00 .* — 1 из 5/.test(text));
  assert(
    'план приходит один раз за утро',
    (await sentTo(maxCoach)).filter((message) => message.text.startsWith('Сегодня у вас')).length === 1,
  );

  // --- Администраторам: разряд на проверку.
  const form = new FormData();
  form.set('rank', 'SPORT_1');
  form.set('orderNumber', '12-с');
  form.set('orderDate', '2025-03-01');
  r = await fetch(`${API}/me/player/rank`, { method: 'PUT', body: form, headers: { Authorization: `Bearer ${pupilToken}` } });
  check('ученица заявила разряд', 200, r.status);
  await dispatch();
  text = await lastTo(maxAdmin);
  assert('администратору пришёл разряд на проверку', /^Разряд на проверку · Ученикова А\./.test(text) && /1-й спортивный/.test(text));

  // --- Администраторам: присутствие не отмечено.
  r = await asAdmin('/clubs/yenisey/settings');
  const original = { attendanceReminderAfterMinutes: r.body?.attendanceReminderAfterMinutes };

  try {
    r = await asAdmin('/clubs/yenisey/settings', { method: 'PATCH', json: { attendanceReminderAfterMinutes: 0 } });
    check('срок напоминания опущен до нуля', 200, r.status);

    const shortStart = new Date(Date.now() + 3_000);
    const shortEnd = new Date(shortStart.getTime() + 3_000);
    r = await asAdmin('/clubs/yenisey/training-sessions', {
      method: 'POST',
      json: {
        trainingTypeId: trainingType?.id,
        coachId,
        startsAt: shortStart.toISOString(),
        endsAt: shortEnd.toISOString(),
        capacity: 2,
      },
    });
    check('короткое занятие заведено', 201, r.status);
    r = await asPupil(`/clubs/yenisey/trainings/${r.body?.id}/booking`, { method: 'POST' });
    check('запись на короткое занятие', 201, r.status);

    await new Promise((resolve) => setTimeout(resolve, Math.max(shortEnd.getTime() - Date.now() + 1_000, 0)));

    r = await schedule(new Date(), ['escalations']);
    assert('планировщик напомнил хотя бы об одном мероприятии', (r.body?.escalations ?? 0) >= 1);
    await dispatch();
    const escalations = (await sentTo(maxAdmin)).filter((message) => message.text.startsWith('Не отмечено присутствие'));
    assert('администратору пришло напоминание об отметке', escalations.some((message) => /Ученикова А\./.test(message.text)));

    const before = escalations.length;
    await schedule(new Date(), ['escalations']);
    await dispatch();
    assert(
      'повторного напоминания о том же нет',
      (await sentTo(maxAdmin)).filter((message) => message.text.startsWith('Не отмечено присутствие')).length === before,
    );
  } finally {
    r = await asAdmin('/clubs/yenisey/settings', { method: 'PATCH', json: original });
    check('срок напоминания возвращён', 200, r.status);
  }
}

/**
 * Утренние сводки в MAX: клуба — администратору, платформы — владельцу
 * платформы.
 *
 * Дата сводки — своя у каждого прогона, далеко в будущем: ключ сводки —
 * дата, и второй прогон смоука за день упёрся бы в уже отправленную. Сутки
 * «вчера» у такой даты пустые, поэтому проверяется не содержание дня (его
 * держат юнит-тесты текстов), а то, что сводка собирается на живой базе,
 * приходит и не повторяется.
 */
async function digests() {
  const adminEmail = process.env.SMOKE_ADMIN_EMAIL;
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD;
  let r = await call('/dev/max/sent?maxUserId=0');

  if (r.status !== 200 || !adminEmail || !adminPassword) {
    console.log('\n=== 38. Утренние сводки в MAX — ПРОПУЩЕНЫ (нет поддельного MAX или нет учётки администратора)');
    return;
  }

  console.log('\n=== 38. Утренние сводки в MAX');

  const maxAdmin = (RUN % 1_000_000_000) * 10 + 9;
  r = await post('/auth/login', { email: adminEmail, password: adminPassword });
  const token = r.body?.accessToken ?? '';
  const asAdmin = (path, options = {}) =>
    call(path, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) } });

  r = await asAdmin('/me/notifications/max', { method: 'POST' });
  await call('/dev/max/events', {
    method: 'POST',
    json: {
      update_type: 'bot_started',
      timestamp: Date.now(),
      chat_id: maxAdmin,
      user: { user_id: maxAdmin, first_name: 'Проба', name: 'Проба', username: null, is_bot: false, last_activity_time: 0 },
      payload: new URL(r.body?.url ?? 'https://x.invalid').searchParams.get('start'),
    },
  });

  const sentTo = async () => (await call(`/dev/max/sent?maxUserId=${maxAdmin}`)).body ?? [];
  const offset = 30 + (Math.floor(RUN / 1000) % 3000);
  const morning = new Date(instantAt(dateIn('Asia/Krasnoyarsk', offset), 9 * 60 + 5, 'Asia/Krasnoyarsk'));
  const run = () => call('/dev/max/schedule', { method: 'POST', json: { now: morning.toISOString(), parts: ['digests'] } });

  r = await run();
  check('проход сводок', 201, r.status);
  await call('/dev/max/dispatch', { method: 'POST' });
  await run();
  await call('/dev/max/dispatch', { method: 'POST' });

  const club = (await sentTo()).filter((message) => message.text.startsWith('Сводка клуба'));
  assert('администратору пришла сводка клуба', club.length === 1);
  assert('в ней «свои» клуба, план на сегодня и итог дня', /всего \d+/.test(club[0]?.text ?? '') && /Сегодня: занятий/.test(club[0]?.text ?? '') && /Итог дня:/.test(club[0]?.text ?? ''));

  r = await asAdmin('/me/notifications');

  if (!r.body?.categories?.some((item) => item.category === 'PLATFORM_DIGEST')) {
    console.log('     Сводка платформы — ПРОПУЩЕНА (SMOKE_ADMIN не владелец платформы: pnpm db:grant-platform)');
    return;
  }

  const platform = (await sentTo()).filter((message) => message.text.startsWith('Сводка платформы'));
  assert('владельцу платформы пришла сводка платформы', platform.length === 1);
  assert('в ней учётки, клубы и состояние MAX', /Учётки: \+\d+ \(всего \d+\)/.test(platform[0]?.text ?? '') && /MAX: подключено \d+/.test(platform[0]?.text ?? ''));
}

/**
 * Уведомления в браузер (Web Push): подписка устройства, доставка на все
 * устройства человека, отозванная подписка, переход подписки к другому
 * человеку и отписка.
 *
 * Через поддельные службы push (/dev/push): настоящий браузер смоуку не
 * поднять, а шифрование сообщения — забота библиотеки web-push.
 */
async function webPush() {
  let r = await call('/dev/push/sent?endpoint=none');

  if (r.status !== 200) {
    console.log('\n=== 39. Уведомления в браузер — ПРОПУЩЕНЫ (нет поддельных служб push: API с ключами VAPID или production)');
    return;
  }

  console.log('\n=== 39. Уведомления в браузер');

  const as = (token) => (path, options = {}) =>
    call(path, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) } });
  const endpoint = (tag) => `https://push.example.test/${RUN}-${tag}`;
  const device = (tag) => ({ endpoint: endpoint(tag), keys: { p256dh: `BPk${tag}Key`, auth: `au${tag}` }, expirationTime: null });
  const sentTo = async (tag) => (await call(`/dev/push/sent?endpoint=${encodeURIComponent(endpoint(tag))}`)).body ?? [];

  r = await post('/auth/register', registration({ lastName: 'Браузеров' }));
  const asA = as(r.body?.accessToken ?? '');

  r = await asA('/me/notifications');
  assert('уведомления в браузере доступны', r.body?.push?.available === true && typeof r.body?.push?.publicKey === 'string');
  assert('устройств пока нет', r.body?.push?.devices === 0);

  r = await asA('/me/notifications/push', { method: 'PUT', json: { ...device('x'), endpoint: 'http://10.0.0.1/admin' } });
  check('подписка не на https отвергнута', 400, r.status);

  r = await asA('/me/notifications/push', { method: 'PUT', json: device('a') });
  check('устройство подписано — целиком, как отдаёт браузер', 200, r.status);
  r = await asA('/me/notifications/push', { method: 'PUT', json: device('b') });
  assert('второе устройство', r.body?.push?.devices === 2);

  // Второе устройство браузер отозвал: служба push ответит на него 410.
  await call('/dev/push/gone', { method: 'POST', json: { endpoint: endpoint('b') } });

  r = await asA('/me/notifications/test', { method: 'POST' });
  check('проверочное без MAX, только браузер', 204, r.status);
  await call('/dev/max/dispatch', { method: 'POST' });

  const delivered = await sentTo('a');
  assert('дошло до браузера заголовком и текстом', delivered.at(-1)?.title === 'Енисей' && /Проверка связи/.test(delivered.at(-1)?.body ?? ''));
  assert('ведёт в настройки уведомлений', /\/cabinet#notifications$/.test(delivered.at(-1)?.url ?? ''));

  r = await asA('/me/notifications');
  assert('отозванная подписка удалена', r.body?.push?.devices === 1);

  // Тот же браузер, вошёл другой человек: подписка переходит к нему.
  r = await post('/auth/register', registration({ lastName: 'Сменщиков' }));
  const asB = as(r.body?.accessToken ?? '');
  r = await asB('/me/notifications/push', { method: 'PUT', json: device('a') });
  assert('подписка перешла ко второму', r.body?.push?.devices === 1);
  r = await asA('/me/notifications');
  assert('у первого её больше нет', r.body?.push?.devices === 0);

  r = await asA('/me/notifications/push/unsubscribe', { method: 'POST', json: { endpoint: endpoint('a') } });
  r = await asB('/me/notifications');
  assert('чужую подписку не снять', r.body?.push?.devices === 1);

  r = await asB('/me/notifications/push/unsubscribe', { method: 'POST', json: { endpoint: endpoint('a') } });
  check('своя подписка снята', 201, r.status);
  assert('устройств не осталось', r.body?.push?.devices === 0);
}

main().catch((error) => {
  console.error('Проверка не выполнена:', error.message);
  console.error('Поднят ли API? Ожидается на', API);
  process.exitCode = 1;
});

/**
 * Страница клуба: описание, баннер, тренерский состав, неделя мероприятий
 * (решения владельца от 24.09.2026).
 *
 * Настоящий баннер клуба прогон не трогает: если он уже есть, сценарии баннера
 * пропускаются — заменить и удалить его значило бы стереть снимок клуба.
 * Описание и состав возвращаются к исходным.
 */
async function clubPage() {
  const adminEmail = process.env.SMOKE_ADMIN_EMAIL;
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.log('\n=== 40. Страница клуба — ПРОПУЩЕНА (нет учётки администратора)');
    return;
  }

  console.log('\n=== 40. Страница клуба: описание, баннер, тренеры, неделя');

  const { default: sharp } = await import('sharp');
  const as = (token) => (path, options = {}) =>
    call(path, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) } });

  const uploadBanner = async (token, color) => {
    const bytes = await sharp({
      create: { width: 2000, height: 800, channels: 3, background: color },
    }).png().toBuffer();
    const form = new FormData();
    form.set('file', new Blob([bytes], { type: 'image/png' }), 'banner.png');
    const response = await fetch(`${API}/clubs/yenisey/settings/banner`, {
      method: 'PUT',
      body: form,
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body };
  };

  let r = await post('/auth/login', { email: adminEmail, password: adminPassword });
  const adminToken = r.body?.accessToken ?? '';
  const asAdmin = as(adminToken);

  r = await asAdmin('/clubs/yenisey/settings');
  const originalDescription = r.body?.description ?? null;
  const originalBanner = r.body?.bannerFileId ?? null;

  // --- Описание.
  r = await asAdmin('/clubs/yenisey/settings', { method: 'PATCH', json: { description: '  Клуб проверки: играем каждый день  ' } });
  check('описание клуба сохранено', 200, r.status);
  assert('пробелы по краям срезаны', r.body?.description === 'Клуб проверки: играем каждый день');

  r = await call('/clubs/yenisey');
  assert('описание видно на открытой странице', r.body?.description === 'Клуб проверки: играем каждый день');

  r = await asAdmin('/clubs/yenisey/settings', { method: 'PATCH', json: { bannerFileId: 'чужой' } });
  check('баннер правкой настроек не ставится', 400, r.status);

  r = await asAdmin('/clubs/yenisey/settings', { method: 'PATCH', json: { description: originalDescription ?? '' } });
  check('описание возвращено', 200, r.status);
  assert('пустое описание — это «нет описания»', r.body?.description === originalDescription);

  // --- Баннер.
  if (originalBanner) {
    console.log('  ПРОПУЩЕНО: у клуба уже есть баннер — прогон его не заменяет');
  } else {
    r = await post('/auth/register', registration({ lastName: 'Клиентов', firstName: 'Баннер' }));
    const clientToken = r.body?.accessToken ?? '';

    r = await uploadBanner(clientToken, { r: 200, g: 40, b: 40 });
    check('клиент баннер клуба не ставит', 403, r.status);

    r = await uploadBanner(adminToken, { r: 20, g: 110, b: 90 });
    check('баннер загружен', 200, r.status);
    const firstBanner = r.body?.bannerFileId;
    assert('у клуба появился баннер', typeof firstBanner === 'string');

    let response = await fetch(`${API}/files/${firstBanner}`);
    check('баннер отдаётся без входа', 200, response.status);
    assert('баннер пережат в WebP', response.headers.get('content-type') === 'image/webp');
    const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    assert('баннер обрезан до 1600×500', meta.width === 1600 && meta.height === 500);

    r = await call('/clubs/yenisey');
    assert('баннер виден на открытой странице', r.body?.bannerFileId === firstBanner);

    r = await uploadBanner(adminToken, { r: 30, g: 60, b: 160 });
    check('баннер заменён', 200, r.status);
    response = await fetch(`${API}/files/${firstBanner}`);
    check('старый баннер удалён вместе с заменой', 404, response.status);

    r = await asAdmin('/clubs/yenisey/settings/banner', { method: 'DELETE' });
    check('баннер снят', 200, r.status);
    assert('у клуба баннера больше нет', r.body?.bannerFileId === null);
  }

  // --- Тренерский состав.
  r = await asAdmin('/clubs/yenisey/settings/coaches');
  check('тренерский состав читается', 200, r.status);
  const originalShown = (r.body ?? []).filter((coach) => coach.order !== null).map((coach) => coach.id);

  r = await post('/auth/register', registration({ lastName: 'Тренеров', firstName: 'Витрина' }));
  const probeCoachId = r.body?.user?.id;
  const asProbe = as(r.body?.accessToken ?? '');

  r = await asAdmin('/clubs/yenisey/settings/coaches', { method: 'PUT', json: { coachIds: [probeCoachId] } });
  check('клиента в тренерский состав не поставить', 400, r.status);

  r = await asAdmin(`/clubs/yenisey/people/${probeCoachId}/role`, { method: 'PATCH', json: { role: 'COACH' } });
  check('пробному тренеру выдана роль', 200, r.status);

  r = await asAdmin('/clubs/yenisey/settings/coaches', {
    method: 'PUT',
    json: { coachIds: [probeCoachId, ...originalShown] },
  });
  check('состав сохранён', 200, r.status);
  assert('пробный тренер — первым', r.body?.[0]?.id === probeCoachId && r.body?.[0]?.order === 1);

  r = await asAdmin('/clubs/yenisey/settings/coaches', { method: 'PUT', json: { coachIds: [probeCoachId, probeCoachId] } });
  check('дважды одного тренера не поставить', 400, r.status);

  r = await asProbe('/clubs/yenisey/settings/coaches', { method: 'PUT', json: { coachIds: [] } });
  check('тренер состав не правит', 403, r.status);

  r = await call('/clubs/yenisey');
  const shownCoach = r.body?.coaches?.[0];
  assert('состав виден на открытой странице по порядку', shownCoach?.id === probeCoachId);
  assert('имя тренера сокращено', /^\S+ \S\.$/.test(shownCoach?.name ?? ''));

  r = await asAdmin(`/clubs/yenisey/people/${probeCoachId}/role`, { method: 'PATCH', json: { role: 'CLIENT' } });
  check('роль тренера снята', 200, r.status);
  r = await call('/clubs/yenisey');
  assert('бывший тренер ушёл из состава', !(r.body?.coaches ?? []).some((coach) => coach.id === probeCoachId));

  r = await asAdmin('/clubs/yenisey/settings/coaches', { method: 'PUT', json: { coachIds: originalShown } });
  check('состав возвращён', 200, r.status);

  // --- Неделя мероприятий.
  const monday = new Date();
  monday.setUTCHours(0, 0, 0, 0);
  const week = { from: monday.toISOString(), to: new Date(monday.getTime() + 7 * 86400_000).toISOString() };
  r = await call(`/clubs/yenisey/events?${new URLSearchParams(week)}`);
  check('мероприятия за неделю', 200, r.status);
  assert('все — внутри окна и не в прошлом', (r.body ?? []).every(
    (event) => event.startsAt < week.to && new Date(event.startsAt).getTime() >= Date.now() - 60_000,
  ));

  r = await call(`/clubs/yenisey/events?${new URLSearchParams({ from: week.from, to: new Date(monday.getTime() + 40 * 86400_000).toISOString() })}`);
  check('окно больше месяца отклонено', 400, r.status);

  r = await call('/clubs/yenisey/events?from=вчера');
  check('негодная дата окна отклонена', 400, r.status);
}
