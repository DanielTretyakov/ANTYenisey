#!/usr/bin/env bash
#
# Демо-стенд КНТ (demo.ant-yenisey.ru): выкладка и ночное обновление данных.
#
#   cd /home/yenisey/yenisey-demo && bash deploy/deploy-demo.sh           # выкладка
#   cd /home/yenisey/yenisey-demo && bash deploy/deploy-demo.sh refresh   # только данные
#   cd /home/yenisey/yenisey-demo && bash deploy/deploy-demo.sh reset     # данные с нуля
#
# Боевой стенд скрипт не трогает: другой каталог, другой проект compose
# (yenisey-demo), своя база. Через ssh — отвязанным от сессии, как deploy.sh:
#
#   ssh сервер 'cd /home/yenisey/yenisey-demo && setsid nohup bash deploy/deploy-demo.sh > ~/deploy-demo.log 2>&1 < /dev/null &'
#
# refresh — для cron раз в сутки: demo-world раскладывает новые дни на краю
# окна и отмечает прошедшее, и демо не устаревает.
# reset — после показа, где заказчики натыкали своё: база стирается целиком.

set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="docker compose --env-file deploy/.env.demo -f deploy/compose.demo.yml"
MODE="${1:-deploy}"

[ -f deploy/.env.demo ] || { echo "Нет deploy/.env.demo — скопируйте из .env.demo.example и заполните."; exit 1; }

world() {
  $COMPOSE run --rm demo-api sh -c 'cd /repo/apps/api && node --experimental-strip-types scripts/demo-world.ts'
}

migrate() {
  $COMPOSE run --rm demo-api sh -c 'cd /repo && pnpm --filter @yenisey/database exec prisma migrate deploy'
  $COMPOSE run --rm demo-api sh -c 'cd /repo/packages/database && node --experimental-strip-types prisma/seed-cities.ts'
}

case "$MODE" in
  refresh)
    world
    exit 0
    ;;
  reset)
    $COMPOSE down
    docker volume rm yenisey-demo_demo-postgres-data
    $COMPOSE up -d demo-postgres
    migrate
    world
    $COMPOSE up -d
    exit 0
    ;;
  deploy) ;;
  *)
    echo "Неизвестный режим: $MODE (deploy | refresh | reset)"
    exit 1
    ;;
esac

echo "=== 1/4  Проверяю сервер"
# Сервер — 1 ядро и 4 ГБ на двоих с боевым стендом. Сборка Next.js съедает
# полтора-два гигабайта; не хватит — её убьёт OOM, а вместе с ней может
# достаться и боевым контейнерам.
free -m
AVAILABLE=$(free -m | awk '/^Mem:/ {print $7}')
SWAP=$(free -m | awk '/^Swap:/ {print $2}')
if [ "$AVAILABLE" -lt 1500 ] && [ "$SWAP" -lt 2000 ]; then
  echo "Свободно ${AVAILABLE} МБ и своп ${SWAP} МБ — сборку не начинаю. Добавьте своп (docs/DEPLOY.md)."
  exit 1
fi
docker network inspect yenisey_default > /dev/null || { echo "Нет сети yenisey_default — боевой стенд не поднят?"; exit 1; }

echo "=== 2/4  Забираю код и собираю образы"
git pull --ff-only
# nice: сборка не должна отнимать процессор у боевого API посреди дня.
nice -n 19 $COMPOSE build

echo "=== 3/4  База: миграции, города, демо-мир"
$COMPOSE up -d demo-postgres
migrate
world

echo "=== 4/4  Запускаю службы"
$COMPOSE up -d

echo
$COMPOSE ps
echo
echo "Если демо открывается впервые — блок demo.{\$DOMAIN} в боевом Caddyfile и"
echo "перечитать его: docker compose --env-file /opt/yenisey/deploy/.env -f /opt/yenisey/deploy/compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile"
