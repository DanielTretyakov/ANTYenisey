# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## В репозитории живут две несвязанные системы

Это не монорепозиторий одного продукта. Под одним корнем соседствуют:

1. **«Енисей»** — SaaS-платформа для клубов настольного тенниса: `apps/`, `packages/`, `docs/`. Это собственно продукт.
2. **Компилятор памяти** — `scripts/`, `hooks/`, `daily/`, `knowledge/`, `AGENTS.md`, `README.md`, `pyproject.toml`. Внешний проект ([claude-memory-compiler](https://github.com/coleam00/claude-memory-compiler)), который превращает транскрипты сессий в базу знаний.

Отсюда две ловушки. **`README.md` в корне описывает компилятор памяти, а не «Енисей»** — за документацией продукта иди в `docs/`. И `knowledge/concepts/` — это выжимки из разговоров, а не проектная документация: они могут устареть относительно кода.

Языки не пересекаются: продукт — TypeScript под pnpm, память — Python под uv.

## Команды

Продукт (pnpm 10 + turbo, из корня):

```bash
pnpm dev            # apps/api и apps/web в watch-режиме
pnpm typecheck      # по всем пакетам
pnpm test           # node --test
pnpm smoke          # 164 сценария против поднятого API и живого Postgres
pnpm db:migrate     # prisma migrate dev
pnpm db:studio
pnpm db:create-admin -- --email a@club.ru --password "..." --name "Иванов Иван"
```

Один тест — напрямую, минуя turbo:

```bash
cd apps/api && node --test --experimental-strip-types src/auth/tokens.test.ts
```

Проверка схемы БД на одноразовой базе:

```bash
pnpm --filter @yenisey/database verify
```

`verify` разворачивает схему с нуля и намеренно пишет некорректные данные, проверяя, что база физически не даёт смешать данные двух клубов. **Направлять только на пустую одноразовую базу.** После `pnpm smoke` остаются учётки `probe-*@example.com` — убираются через `pnpm db:clean-probes`.

Память (uv, Python):

```bash
uv run python scripts/compile.py            # дневные логи -> статьи
uv run python scripts/query.py "вопрос"
uv run python scripts/lint.py
```

## Архитектура продукта

`apps/api` — NestJS. Модули `auth`, `tenants`, `users`, `prisma`, `config`. `apps/web` — Next.js (app router). `packages/database` — Prisma, единственный владелец схемы. `packages/types` — общие типы, собирается через `tsc -p tsconfig.build.json`.

Клиент Prisma генерируется в `packages/database/generated/` и **в git не попадает** — после свежего клона и после правки схемы нужен `pnpm db:generate`, иначе типы не сойдутся.

### Мультиарендность — главное ограничение

Изоляция клубов держится на составных ключах и проверяется на уровне БД, а не только в коде. Правила схемы, которые нельзя нарушать:

- **Деньги — целые числа в копейках.** Не рубли с дробной частью. Конвертация только на границе представления.
- **Удаления нет.** Клиент деактивируется через `deactivatedAt`/`anonymizedAt`; на внешних ключах `onDelete: Restrict`.
- **Часть ограничений живёт в raw SQL.** `packages/database/prisma/constraints.sql` — 32 CHECK, 2 частичных уникальных индекса и 3 EXCLUDE (пересечение броней, шаблона недели и расписания дня). Prisma такое не выражает, поэтому при изменении схемы этот файл правится руками отдельно от миграции.
- **Цены и шаг брони — у зала (`Hall`), а не у клуба.** У клуба остаётся то, что составляет договор с клиентом: часовой пояс, политика неявки, правила абонемента.

Сценарии на изоляцию — `packages/database/prisma/tests/schema-tests.sql`.

### Окружение

`.env` — один на весь монорепозиторий, в корне, в git не попадает. Переменные валидируются при старте API в `apps/api/src/config/env.ts`, приложение падает сразу. Отдельно проверяется, что `JWT_ACCESS_SECRET` и `JWT_REFRESH_SECRET` различаются: при совпадении refresh-токен принимается как access и обходит короткий срок жизни.

Подробности первого запуска и известные ограничения каркаса — `docs/DEVELOPMENT.md`. Техзадание — `docs/TZ.md`.

## Особенности этой машины (Windows)

- **git-bash обязателен для Agent SDK.** Скрипты памяти запускают Claude Code CLI, а он без git-bash не стартует и сообщает лишь `exit code 1`. `ensure_git_bash()` в `scripts/config.py` находит путь сам; переменную окружения держать не нужно. Если SDK падает непонятно — первым делом передай `stderr=` в `ClaudeAgentOptions`, настоящая ошибка только там.
- **Консоль в cp1251.** `print` с `₽`, эмодзи или длинным тире падает с `UnicodeEncodeError`, а `logging` молча теряет строку. Отсюда `force_utf8_io()` в `scripts/config.py` и `encoding="utf-8"` у всех `basicConfig`. В новых Python-скриптах проекта вызывай `force_utf8_io()` первой строкой `main()`.
- **`core.autocrlf=true`.** Контрольные суммы вендоренных скиллов в `.claude/skills/` считаются по LF-байтам, поэтому в `.gitattributes` для них стоит `text eol=lf`. Без этого свежий чекаут даёт «stale snapshot» и скилл молча не грузится.
- **TLS нестабилен.** `git push` периодически падает с `schannel: failed to receive handshake` — повторить. Проверяй код возврата именно `git`: `git push | tail -3` всегда вернёт 0.
- Образы с Docker Hub не тянутся (TLS-таймаут), Postgres установлен нативно.

## Язык

Проект русскоязычный: сообщения коммитов, комментарии в коде, документация в `docs/` — по-русски. Идентификаторы и имена файлов — английские.
