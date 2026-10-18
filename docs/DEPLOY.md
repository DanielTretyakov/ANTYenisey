# Развёртывание «Енисея»

## Боевой стенд

Поднят 22.09.2026. Секретов здесь нет и быть не должно — они только в
`deploy/.env` на самом сервере.

| Что | Значение |
|---|---|
| Домен | `ant-yenisey.ru` (регистратор reg.ru, там же почта — MX не трогаем) |
| Сервер | reg.ru, «KNT RF», Москва (ФЗ-152), 178.21.11.159 |
| Железо | 1 ядро, 4 ГБ RAM, 40 ГБ NVMe, Ubuntu 24.04 |
| Вход | по ключу, `yenisey@178.21.11.159`; вход по паролю отключён |
| Код | `/opt/yenisey`, ветка `app-skeleton` |
| Бэкап | ежедневно в 04:00 по `cron`, 14 последних копий |

Подключение с рабочей машины:

```bash
ssh -i ~/.ssh/yenisey_deploy yenisey@178.21.11.159
```


Одна машина, четыре контейнера: база, API, веб и прокси, который снимает TLS.
Отдельных staging и prod на старте нет — решение из плана хостинга: пока клуб
один, вторая машина стоит денег и внимания, а даёт немного.

## Что нужно купить

| Что | Требование | Почему именно так |
|---|---|---|
| Сервер | **VPS с root-доступом**, 2 vCPU, 4 ГБ RAM, 40+ ГБ SSD, Ubuntu 24.04 | Виртуальный хостинг (шаред) не подойдёт: там нет ни root, ни Docker, ни своего Postgres. 4 ГБ — потому что сборка Next съедает около двух, а рядом работает база |
| ЦОД | В России | 152-ФЗ о персональных данных и требования ЮKassa |
| Домен | Любой, с возможностью править A-запись | На него выписывается сертификат |

В первый же день проверьте на сервере, тянутся ли образы с Docker Hub:
`docker pull postgres:18-alpine`. С части российских адресов он недоступен, и
выяснить это лучше в тестовый период, а не в день запуска.

## Первый запуск

Всё, кроме первого шага, делается на сервере по SSH.

**1. Домен.** A-запись домена → IP сервера. Проверить: `dig +short ваш-домен`
должен ответить адресом сервера. До того, как это сработает, за сертификатом
идти бессмысленно — Let's Encrypt проверяет владение доменом обращением к нему.

**2. Сервер.**

```bash
# Отдельный пользователь: под root приложение работать не должно.
adduser --disabled-password --gecos '' yenisey
usermod -aG docker yenisey

apt update && apt install -y docker.io docker-compose-v2 git
systemctl enable --now docker

# Брандмауэр: снаружи нужны только ssh и веб.
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

**3. Код и переменные.**

```bash
su - yenisey
git clone https://github.com/DanielTretyakov/ANTYenisey.git /opt/yenisey
cd /opt/yenisey

cp deploy/.env.production.example deploy/.env
chmod 600 deploy/.env

# Секреты генерируются ЗДЕСЬ и никуда больше не копируются.
openssl rand -base64 48   # → POSTGRES_PASSWORD
openssl rand -base64 48   # → JWT_ACCESS_SECRET
openssl rand -base64 48   # → JWT_REFRESH_SECRET
nano deploy/.env          # заполнить DOMAIN, TLS_EMAIL и три секрета
```

**4. Подъём.**

```bash
docker compose --env-file deploy/.env -f deploy/compose.yml up -d --build
```

Первая сборка идёт 5–10 минут. Дальше — миграции и клуб:

```bash
COMPOSE="docker compose --env-file deploy/.env -f deploy/compose.yml"

$COMPOSE run --rm api sh -c 'cd /repo && pnpm --filter @yenisey/database exec prisma migrate deploy'
$COMPOSE run --rm api sh -c 'cd /repo && pnpm --filter @yenisey/database run seed'

# Администратор клуба. Пароль — длинный и не из этого файла.
$COMPOSE run --rm api sh -c 'cd /repo/apps/api && node --experimental-strip-types scripts/create-admin.ts --email admin@ваш-домен --password "..." --name "Фамилия Имя Отчество" --phone +79990000000 --birthdate 1985-03-12'
```

**5. Проверка.**

```bash
curl -sf https://ваш-домен/api/health && echo OK
```

Открыть `https://ваш-домен`, войти администратором, завести залы и столы.
Демо-данные (`seed-demo`) на боевой машине не нужны — они заводят выдуманные
занятия и турниры.

**6. Уведомления в браузере.** Необязательно, но без ключей их нет. Ключи
генерируются один раз и больше не меняются — новая пара отменяет все
подписки браузеров:

```bash
npx web-push generate-vapid-keys   # → VAPID_PUBLIC_KEY и VAPID_PRIVATE_KEY
nano deploy/.env                   # плюс VAPID_SUBJECT=mailto:почта-владельца
$COMPOSE up -d api
```

**7. Бот уведомлений в MAX.** Необязательный шаг: без него сайт работает, а в
личном кабинете вместо кнопки подключения написано, что бот ещё не готов.

Бота заводит **верифицированный профиль организации, ИП или самозанятого** на
business.max.ru, и бот проходит модерацию — это делает заказчик, не
разработчик. Когда бот одобрен:

```bash
openssl rand -hex 32      # → MAX_WEBHOOK_SECRET
nano deploy/.env          # MAX_BOT_TOKEN, MAX_BOT_LINK, MAX_WEBHOOK_SECRET
$COMPOSE up -d api        # при старте API сам подпишет вебхук
$COMPOSE logs api | grep -i 'вебхук MAX'
```

MAX шлёт события на `https://ваш-домен/api/max/webhook` — только на 443-й
порт и с сертификатом доверенного центра; Caddy это уже обеспечивает. Сводку
платформы получает владелец платформы:

```bash
$COMPOSE run --rm api sh -c 'cd /repo/apps/api && node --experimental-strip-types scripts/grant-platform.ts --email владелец@почта'
```

## Выкладка обновлений

```bash
cd /opt/yenisey && bash deploy/deploy.sh
```

Скрипт снимает копию базы, забирает код, собирает образы, накатывает миграции
и перезапускает службы — именно в этом порядке. Миграции идут **до**
перезапуска: иначе новый код успевает увидеть старую схему.

Откат — на предыдущий коммит и та же команда. Миграции при этом **не
откатываются**: Prisma не умеет обратных миграций, и откат схемы делается
восстановлением из копии, снятой перед выкладкой.

## Бэкапы

`deploy/backup.sh` снимает копию и хранит четырнадцать последних. Он вызывается
из выкладки автоматически, но по расписанию его надо завести отдельно:

```bash
crontab -e
# каждый день в 4 утра
0 4 * * * cd /opt/yenisey && bash deploy/backup.sh >> /var/log/yenisey-backup.log 2>&1
```

**Копии лежат на том же сервере** и переживают пересоздание контейнеров, но не
потерю машины. Забирать их наружу — отдельная задача, и до неё бэкап защищает
только от своих ошибок, не от смерти сервера:

```bash
# с рабочей машины
ssh yenisey@сервер 'docker compose --env-file /opt/yenisey/deploy/.env -f /opt/yenisey/deploy/compose.yml exec -T postgres sh -c "cat /backups/$(ls -1t /backups | head -1)"' > копия.sql.gz
```

В базе лежат и файлы — аватары, сканы приказов, фото тренеров хранятся
колонкой `bytea` (см. `FileStorage`). Отдельного бэкапа файлов нет и не нужно,
но дамп от этого растёт быстрее, чем ожидаешь.

Восстановление:

```bash
$COMPOSE exec -T postgres sh -c 'gunzip -c /backups/ИМЯ.sql.gz | psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

## Демо-стенд

`https://demo.ant-yenisey.ru` — второй экземпляр на том же сервере для показа
заказчикам (решение владельца от 17.10.2026). Свой каталог `/home/yenisey/yenisey-demo` (в `/opt` пользователю
`yenisey` писать нельзя),
свой проект compose `yenisey-demo` (`deploy/compose.demo.yml`), своя база и
свои секреты (`deploy/.env.demo`, образец — `.env.demo.example`). Сообщения,
почта, оплата и джоба неявок выключены.

Данные — выдуманный «живой мир» `apps/api/scripts/demo-world.ts`: четыре клуба
в Красноярске, Абакане с Минусинском и Иркутске (другой часовой пояс — видна
подпись «у вас …»), залы, тренеры, виды занятий, шаблон недели, мероприятия
на четыре недели назад и три вперёд, клиенты с записями и визитами, абонементы,
ленты и новости платформы. Сценарий пишет **только в базу с «demo» в имени** и
идемпотентен: повторный прогон раскладывает новые дни на краю окна и отмечает
прошедшее (86 % «пришёл»). Локально:

```bash
DATABASE_URL=postgresql://…/yenisey_demo DEMO_PASSWORD=… pnpm demo:world
```

Демо-учётки (пароль — `DEMO_PASSWORD`, все на `knt.test`): `platform@` (владелец
платформы), учётки «Енисея» — `yenisey.owner@` (руководитель клуба),
`yenisey.manager@` (управляющий залов «Пироги» и «Баки»), `yenisey.admin@`
(администратор, на смене каждый день), `yenisey.coach@` (тренер Ковалёв); ещё
`player@`, `parent@` и `child@` (родитель с ребёнком 10 лет). Прежние адреса
(`owner@`, `director@`, `manager@`, `admin@`, `coach@`) сценарий переименовывает
сам. На сайте пароль нигде не написан — его называют заказчику.

**Сеть.** Своего прокси у демо нет: порты 80/443 у боевого Caddy, он же
выписывает сертификат на `demo.`. Службы `demo-api` и `demo-web` подключены к
сети боевого проекта `yenisey_default`. **Имена служб — только с префиксом
`demo-`**: compose заводит имя службы псевдонимом в каждой сети, и служба `api`
в боевой сети делила бы запросы ant-yenisey.ru с боевым API. База демо в боевую
сеть не подключается.

Первый запуск:

```bash
# 1. DNS: A-запись demo.ant-yenisey.ru → IP сервера (панель reg.ru).
# 2. Код и окружение.
git clone -b app-skeleton <репозиторий> /home/yenisey/yenisey-demo
cp /home/yenisey/yenisey-demo/deploy/.env.demo.example /home/yenisey/yenisey-demo/deploy/.env.demo   # заполнить
# 3. Сборка, база, данные, запуск.
cd /home/yenisey/yenisey-demo && setsid nohup bash deploy/deploy-demo.sh > ~/deploy-demo.log 2>&1 < /dev/null &
# 4. Блок demo.{$DOMAIN} в боевом Caddyfile — без перезапуска боевых служб.
cd /opt/yenisey && git fetch
git show origin/app-skeleton:deploy/Caddyfile > deploy/Caddyfile   # на месте, тот же inode
docker compose --env-file deploy/.env -f deploy/compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
git checkout -- deploy/Caddyfile
```

Шаг 4 пишет файл **на месте**: Caddyfile примонтирован в контейнер одним
файлом, а `git pull` и `git checkout` заменяют файл новым, и контейнер
продолжал бы видеть старый до перезапуска. Последняя строка возвращает
рабочую копию боевого стенда к её коммиту; содержимое у контейнера уже новое,
и следующая боевая выкладка его не изменит.

Сборка Next.js съедает полтора-два гигабайта, а сервер общий с боевым:
`deploy-demo.sh` не начинает её, если свободно меньше 1,5 ГБ и своп меньше
2 ГБ, и собирает под `nice`.

Обновление и уход за данными:

```bash
cd /home/yenisey/yenisey-demo && bash deploy/deploy-demo.sh           # новая версия кода
cd /home/yenisey/yenisey-demo && bash deploy/deploy-demo.sh refresh   # только данные
cd /home/yenisey/yenisey-demo && bash deploy/deploy-demo.sh reset     # база с нуля после показа

crontab -e
# каждую ночь: новые дни на краю окна, отметки прошедшего
30 3 * * * cd /home/yenisey/yenisey-demo && bash deploy/deploy-demo.sh refresh >> ~/demo-refresh.log 2>&1
```

## Что смотреть, когда что-то не так

```bash
COMPOSE="docker compose --env-file deploy/.env -f deploy/compose.yml"

$COMPOSE ps                  # кто поднят, кто перезапускается
$COMPOSE logs --tail 100 api # API: падения на старте видны здесь
$COMPOSE logs --tail 50 caddy # сертификат и маршрутизация
```

Частое:

- **API падает на старте** — почти всегда переменные окружения: он проверяет
  их при запуске и пишет, чего не хватает. Отдельно проверяется, что секреты
  access и refresh разные.
- **Сертификат не выписался** — смотреть логи caddy. Обычно A-запись ещё не
  разошлась или 80-й порт закрыт брандмауэром: ACME-проверка ходит по http.
- **Вход работает, но через 15 минут выбрасывает** — не сохраняется кука
  обновления сессии. Проверить, что сайт открыт именно по https: без него
  `secure`-кука не сохраняется браузером.

## Чего здесь пока нет

- **Платежей.** ЮKassa требует оферту и подключённый эквайринг; вебхуки
  придут на `https://домен/api/...`, и публичный адрес для них — половина
  причины, по которой сервер вообще понадобился.
- **Почты.** Провайдер не выбран; до него восстановление пароля не строится.
  Уведомления идут не почтой, а в MAX и в браузер — шаги 6–7 первого запуска.
- **Второго сервера и автоматической выкладки из CI.** Пока клуб один, выкладка
  руками одной командой честнее: каждый шаг виден.
