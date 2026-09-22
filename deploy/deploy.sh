#!/usr/bin/env bash
#
# Выкладка «Енисея» на сервере.
#
#   cd /opt/yenisey && bash deploy/deploy.sh
#
# Делает ровно четыре вещи: забирает свежий код, собирает образы, накатывает
# миграции и перезапускает службы. Порядок не случаен — миграции идут ДО
# перезапуска приложения, иначе новый код успеет увидеть старую схему.

set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="docker compose --env-file deploy/.env -f deploy/compose.yml"

echo "=== 1/5  Проверяю окружение"
[ -f deploy/.env ] || { echo "Нет deploy/.env — скопируйте из .env.production.example и заполните."; exit 1; }

# Бэкап ПЕРЕД миграцией, а не после: откатывать придётся именно к этому
# состоянию, и снимать копию после того, как схема уже изменилась, поздно.
echo "=== 2/5  Снимаю копию базы"
bash deploy/backup.sh

echo "=== 3/5  Забираю код и собираю образы"
git pull --ff-only
$COMPOSE build

echo "=== 4/5  Накатываю миграции"
# Одноразовым контейнером на собранном образе: у него те же зависимости и тот
# же клиент Prisma, что у приложения, и та же переменная DATABASE_URL из
# compose — выводить её здесь заново значит однажды разойтись с настоящей.
# Запускать миграции со своей машины по проброшенному порту — способ когда-
# нибудь накатить их не на ту базу.
$COMPOSE run --rm api sh -c 'cd /repo && pnpm --filter @yenisey/database exec prisma migrate deploy'

echo "=== 5/5  Перезапускаю службы"
$COMPOSE up -d

echo
echo "Готово. Состояние:"
$COMPOSE ps
echo
echo "Если что-то не поднялось: $COMPOSE logs --tail 50 api"
