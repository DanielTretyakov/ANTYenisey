#!/usr/bin/env bash
#
# Прогон схемы против живого Postgres: генерирует DDL из schema.prisma,
# накатывает ограничения целостности и выполняет тестовые сценарии.
#
# Использование:
#   DATABASE_URL="postgresql://postgres:пароль@localhost:5432/yenisey_test" \
#     bash docs/verify-schema.sh
#   или
#   bash docs/verify-schema.sh "postgresql://postgres:пароль@localhost:5432/yenisey_test"
#
# База должна быть ПУСТОЙ и одноразовой — скрипт создаёт в ней таблицы и
# пишет заведомо некорректные данные. Никогда не направлять на боевую БД.

set -uo pipefail

DOCS_DIR="$(cd "$(dirname "$0")" && pwd)"
PGURL="${1:-${DATABASE_URL:-}}"

if [ -z "$PGURL" ]; then
  echo "Не задана строка подключения. Пример:"
  echo "  bash docs/verify-schema.sh \"postgresql://postgres:pass@localhost:5432/yenisey_test\""
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql не найден в PATH. Он ставится вместе с Postgres (или пакетом postgresql-client)."
  echo "На Windows обычно лежит в C:\\Program Files\\PostgreSQL\\<версия>\\bin"
  exit 1
fi

DDL="$(mktemp)"
trap 'rm -f "$DDL"' EXIT

echo "=== 1/4  Генерирую DDL из schema.prisma"
DATABASE_URL="$PGURL" npx --yes prisma@6 migrate diff \
  --from-empty \
  --to-schema-datamodel "$DOCS_DIR/schema.prisma" \
  --script > "$DDL" || { echo "Не удалось сгенерировать DDL"; exit 1; }
echo "    таблиц: $(grep -c 'CREATE TABLE' "$DDL")"

echo "=== 2/4  Создаю таблицы"
psql "$PGURL" -v ON_ERROR_STOP=1 -q -f "$DDL" || { echo "DDL не применился"; exit 1; }

echo "=== 3/4  Накатываю ограничения целостности"
psql "$PGURL" -v ON_ERROR_STOP=1 -q -f "$DOCS_DIR/schema-constraints.sql" \
  || { echo "Ограничения не применились — смотри ошибку выше"; exit 1; }

echo "=== 4/4  Прогоняю тестовые сценарии"
psql "$PGURL" -q -f "$DOCS_DIR/schema-tests.sql" 2>&1 \
  | grep -E 'ТЕСТЫ|OK \(ожидалось\)|ПРОВАЛ'

echo
echo "Готово. Каждая строка выше должна оканчиваться на «OK (ожидалось)»."
