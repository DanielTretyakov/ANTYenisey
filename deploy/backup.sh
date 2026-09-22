#!/usr/bin/env bash
#
# Копия базы «Енисея».
#
#   bash deploy/backup.sh              # снять копию сейчас
#
# Копии ложатся в том postgres-backups внутри контейнера базы, поэтому
# переживают пересоздание контейнеров. Том живёт на диске сервера — а значит
# НЕ переживёт потерю самого сервера: копию стоит регулярно забирать наружу
# (см. docs/DEPLOY.md, раздел про бэкапы).
#
# В базе лежат не только записи, но и файлы: аватары, сканы приказов и фото
# тренеров хранятся колонкой bytea. Отдельного бэкапа для них нет и не нужно —
# он здесь же, и от этого дамп растёт быстрее, чем кажется.

set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="docker compose --env-file deploy/.env -f deploy/compose.yml"

# Сколько копий держать. Четырнадцать ежедневных — две недели, за которые
# ошибку обычно успевают заметить.
KEEP="${BACKUP_KEEP:-14}"

# База может быть ещё не поднята — при самой первой выкладке это нормально, и
# ронять из-за этого всю выкладку незачем.
if ! $COMPOSE ps --status running postgres | grep -q postgres; then
  echo "База не запущена — копию снять не с чего, пропускаю."
  exit 0
fi

STAMP="$(date -u +%Y-%m-%d_%H-%M)"
NAME="yenisey_${STAMP}.sql.gz"

echo "Снимаю копию в ${NAME}"

# pg_dump внутри контейнера базы: версия клиента там заведомо совпадает с
# версией сервера. С хоста это первый источник «server version mismatch».
$COMPOSE exec -T postgres sh -c \
  "pg_dump -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" --format=plain --no-owner | gzip -9 > /backups/${NAME}"

# Проверяем, что копия не пустая: pg_dump, упавший в середине, оставляет
# обрезанный файл, и узнать об этом в день восстановления — худший вариант.
SIZE="$($COMPOSE exec -T postgres sh -c "stat -c %s /backups/${NAME}")"

if [ "${SIZE:-0}" -lt 1024 ]; then
  echo "Копия подозрительно мала (${SIZE} байт) — считаю это ошибкой."
  exit 1
fi

echo "Готово, ${SIZE} байт."

# Старые копии удаляются последними: если удаление сломается, свежая копия уже
# снята.
$COMPOSE exec -T postgres sh -c \
  "ls -1t /backups/yenisey_*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --"

echo "Копий на сервере: $($COMPOSE exec -T postgres sh -c 'ls -1 /backups/yenisey_*.sql.gz 2>/dev/null | wc -l')"
