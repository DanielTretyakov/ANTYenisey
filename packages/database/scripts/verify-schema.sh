#!/usr/bin/env bash
#
# Прогон схемы против живого Postgres: генерирует DDL из schema.prisma,
# накатывает ограничения целостности и выполняет тестовые сценарии.
#
# Использование:
#   DATABASE_URL="postgresql://postgres:пароль@localhost:5432/yenisey_test" \
#     pnpm --filter @yenisey/database verify
#   или
#   bash packages/database/scripts/verify-schema.sh "postgresql://postgres:пароль@localhost:5432/yenisey_test"
#
# База должна быть ПУСТОЙ и одноразовой — скрипт создаёт в ней таблицы и
# пишет заведомо некорректные данные. Никогда не направлять на боевую БД.

set -uo pipefail

SCHEMA_DIR="$(cd "$(dirname "$0")/../prisma" && pwd)"
PGURL="${1:-${DATABASE_URL:-}}"

if [ -z "$PGURL" ]; then
  echo "Не задана строка подключения. Пример:"
  echo "  DATABASE_URL=\"postgresql://postgres:pass@localhost:5432/yenisey_test\" pnpm --filter @yenisey/database verify"
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

# Блок datasource объявляет shadowDatabaseUrl, и Prisma проверяет его при
# любом запуске: без переменной падает «not found», а с адресом рабочей базы —
# «shadow database is the same as the main database». Сам shadow здесь не
# нужен — migrate diff --from-empty к нему не обращается, — поэтому
# подставляем заведомо другое имя, которого может и не существовать.
SHADOW_STUB="${PGURL%%\?*}_shadow_stub"

DATABASE_URL="$PGURL" SHADOW_DATABASE_URL="$SHADOW_STUB" npx --yes prisma@6 migrate diff \
  --from-empty \
  --to-schema-datamodel "$SCHEMA_DIR/schema.prisma" \
  --script > "$DDL" || { echo "Не удалось сгенерировать DDL"; exit 1; }
echo "    таблиц: $(grep -c 'CREATE TABLE' "$DDL")"

echo "=== 2/4  Создаю таблицы"
psql "$PGURL" -v ON_ERROR_STOP=1 -q -f "$DDL" || { echo "DDL не применился"; exit 1; }

echo "=== 3/4  Накатываю ограничения целостности"
psql "$PGURL" -v ON_ERROR_STOP=1 -q -f "$SCHEMA_DIR/constraints.sql" \
  || { echo "Ограничения не применились — смотри ошибку выше"; exit 1; }

echo "=== 4/4  Прогоняю тестовые сценарии"

# Вывод сохраняется, а не только показывается: провал сценария печатается
# строкой «ПРОВАЛ», и до 22.09.2026 скрипт на этом всё равно возвращал ноль.
# Человек, читающий вывод глазами, это замечал; CI — нет.
REPORT="$(mktemp)"
trap 'rm -f "$DDL" "$REPORT"' EXIT

psql "$PGURL" -q -f "$SCHEMA_DIR/tests/schema-tests.sql" 2>&1 \
  | grep -E 'ТЕСТЫ|OK \(ожидалось\)|ПРОВАЛ' \
  | tee "$REPORT"

FAILED="$(grep -c 'ПРОВАЛ' "$REPORT" || true)"
PASSED="$(grep -c 'OK (ожидалось)' "$REPORT" || true)"

echo
echo "Сценариев пройдено: $PASSED, провалов: $FAILED."

if [ "$FAILED" -gt 0 ]; then
  echo "Схема не сошлась с ожиданиями — смотри строки «ПРОВАЛ» выше."
  exit 1
fi

if [ "$PASSED" -eq 0 ]; then
  echo "Ни один сценарий не выполнился — похоже, файл сценариев не доехал."
  exit 1
fi
