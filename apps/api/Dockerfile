# API «Енисея»: NestJS, собранный из монорепозитория.
#
# Собирается ИЗ КОРНЯ репозитория, а не из apps/api:
#   docker build -f apps/api/Dockerfile .
# Иначе в контекст сборки не попадут ни lock-файл, ни пакеты workspace, без
# которых установка зависимостей невоспроизводима.

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# Prisma и argon2 тянут за собой нативные сборки, а OpenSSL нужен клиенту
# Prisma в рантайме — в slim-образе его нет.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

# --- Зависимости ------------------------------------------------------------
# Сначала одни манифесты: слой с установкой переживает правку кода и
# пересобирается только когда меняется сам список зависимостей.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
COPY packages/database/package.json packages/database/
RUN pnpm install --frozen-lockfile

# --- Сборка -----------------------------------------------------------------
FROM deps AS build
COPY . .
# Клиент Prisma в git не попадает, и сгенерировать его нужно до сборки: без
# него не сойдутся типы. К базе генерация не обращается, но переменная должна
# существовать — datasource объявляет её в схеме.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ENV SHADOW_DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build_shadow
RUN pnpm db:generate \
  && pnpm exec turbo run build --filter=@yenisey/api...

# --- Рантайм ----------------------------------------------------------------
# Репозиторий переносится целиком: NestJS не бандлится, ему нужны настоящие
# node_modules, а pnpm раскладывает их симлинками внутрь репозитория — вырезать
# из этого «только нужное» значит ломать ссылки.
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo

# Не root: процесс, пробитый через уязвимость в зависимости, не должен получать
# машину целиком. Пользователь node есть в образе изначально.
RUN chown -R node:node /repo
USER node

WORKDIR /repo/apps/api
EXPOSE 3001

# Миграции накатывает выкладка, а не старт контейнера: два экземпляра,
# поднявшись одновременно, налетели бы друг на друга, а неудачная миграция
# уронила бы приложение вместо того, чтобы остановить выкладку.
CMD ["node", "dist/main.js"]
