# Веб «Енисея»: Next.js в режиме standalone.
#
# Собирается из корня репозитория:
#   docker build -f apps/web/Dockerfile .

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
COPY packages/database/package.json packages/database/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .

# Адрес API попадает в БРАУЗЕРНЫЙ код на сборке, а не в рантайме: Next
# подставляет значение NEXT_PUBLIC_* прямо в бандл. Поменять его потом
# переменной окружения контейнера нельзя — только пересборкой.
#
# Пустая строка по умолчанию не оплошность: веб и API стоят за одним доменом,
# запрос уходит на `/api/...` тем же источником. Так первой стороной становится
# и кука обновления сессии — межсайтовой ей быть незачем.
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ENV SHADOW_DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build_shadow

# Самодостаточная сборка — только здесь: на Windows она падает на симлинках, и
# обычный `pnpm build` на рабочей машине её не включает (см. next.config.ts).
ENV NEXT_STANDALONE=on

RUN pnpm db:generate \
  && pnpm exec turbo run build --filter=@yenisey/web...

# --- Рантайм ----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# Standalone-сборка уже несёт в себе нужные куски node_modules — ни pnpm, ни
# исходников здесь не нужно. Статика и public лежат рядом отдельными слоями:
# Next ищет их по путям относительно сервера.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public

USER node
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
