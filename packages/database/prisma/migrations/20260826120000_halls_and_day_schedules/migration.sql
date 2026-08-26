-- Залы, назначение закрытого времени и расписание на дату.
--
-- Три изменения разом, потому что они держатся друг за друга:
--   * цены и шаг брони переезжают с клуба на зал (Hall);
--   * у закрытого времени появляется назначение и тренер;
--   * разовые окна (TableClosure) заменяются расписанием на конкретную дату.
--
-- Миграция переносит данные, а не пересоздаёт таблицы: у клуба уже заведены
-- столы, настройки и закрытое время, и терять их нельзя.

-- CreateEnum
CREATE TYPE "ClosurePurpose" AS ENUM ('RENT', 'SPARRING', 'TRAINING', 'ROBOT', 'OTHER');

-- ---------------------------------------------------------------------------
-- 1. Зал
-- ---------------------------------------------------------------------------

CREATE TABLE "Hall" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bookingStep" "BookingStep" NOT NULL DEFAULT 'MIN_30',
    "tableHourPrice" INTEGER NOT NULL,
    "tableExtra30MinPrice" INTEGER NOT NULL,
    "hasRobotOption" BOOLEAN NOT NULL DEFAULT false,
    "robot30MinPrice" INTEGER,
    "robot60MinPrice" INTEGER,
    "robotExtra30MinPrice" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hall_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Hall_tenantId_idx" ON "Hall"("tenantId");
CREATE UNIQUE INDEX "Hall_id_tenantId_key" ON "Hall"("id", "tenantId");
CREATE UNIQUE INDEX "Hall_tenantId_name_key" ON "Hall"("tenantId", "name");

ALTER TABLE "Hall" ADD CONSTRAINT "Hall_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Каждому существующему клубу — один зал с его нынешними ценами. Настройки не
-- сбрасываются на умолчания: клуб их уже заводил, и обнулить их значило бы
-- заставить сделать это заново.
INSERT INTO "Hall" (
  "id", "tenantId", "name",
  "bookingStep", "tableHourPrice", "tableExtra30MinPrice",
  "hasRobotOption", "robot30MinPrice", "robot60MinPrice", "robotExtra30MinPrice",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, t."id", 'Основной зал',
  t."bookingStep", t."tableHourPrice", t."tableExtra30MinPrice",
  t."hasRobotOption", t."robot30MinPrice", t."robot60MinPrice", t."robotExtra30MinPrice",
  now(), now()
FROM "Tenant" AS t;

-- ---------------------------------------------------------------------------
-- 2. Столы переезжают в зал
-- ---------------------------------------------------------------------------

-- Колонка добавляется допускающей NULL: на существующих строках значения ещё
-- нет, и NOT NULL здесь упал бы.
ALTER TABLE "Table" ADD COLUMN "hallId" TEXT;

UPDATE "Table" AS tbl
SET "hallId" = h."id"
FROM "Hall" AS h
WHERE h."tenantId" = tbl."tenantId";

ALTER TABLE "Table" ALTER COLUMN "hallId" SET NOT NULL;

-- Название стола уникально теперь в пределах зала, а не клуба: «Стол 1»
-- законно есть и в основном зале, и в малом.
DROP INDEX "Table_tenantId_label_key";
CREATE INDEX "Table_hallId_idx" ON "Table"("hallId");
CREATE UNIQUE INDEX "Table_hallId_label_key" ON "Table"("hallId", "label");

ALTER TABLE "Table" ADD CONSTRAINT "Table_hallId_tenantId_fkey"
  FOREIGN KEY ("hallId", "tenantId") REFERENCES "Hall"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Расписание на конкретную дату
-- ---------------------------------------------------------------------------

CREATE TABLE "HallDaySchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hallId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HallDaySchedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HallDaySchedule_tenantId_date_idx" ON "HallDaySchedule"("tenantId", "date");
CREATE UNIQUE INDEX "HallDaySchedule_hallId_date_key" ON "HallDaySchedule"("hallId", "date");

CREATE TABLE "DayClosure" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "purpose" "ClosurePurpose" NOT NULL DEFAULT 'OTHER',
    "coachId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DayClosure_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DayClosure_scheduleId_idx" ON "DayClosure"("scheduleId");
CREATE INDEX "DayClosure_tableId_idx" ON "DayClosure"("tableId");
CREATE INDEX "DayClosure_coachId_idx" ON "DayClosure"("coachId");

ALTER TABLE "HallDaySchedule" ADD CONSTRAINT "HallDaySchedule_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HallDaySchedule" ADD CONSTRAINT "HallDaySchedule_hallId_tenantId_fkey"
  FOREIGN KEY ("hallId", "tenantId") REFERENCES "Hall"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DayClosure" ADD CONSTRAINT "DayClosure_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DayClosure" ADD CONSTRAINT "DayClosure_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "HallDaySchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DayClosure" ADD CONSTRAINT "DayClosure_tableId_tenantId_fkey"
  FOREIGN KEY ("tableId", "tenantId") REFERENCES "Table"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. Разовые окна превращаются в расписание на дату
-- ---------------------------------------------------------------------------
--
-- Прежние TableClosure хранили мгновения UTC, новые записи — минуты от местной
-- полуночи, поэтому время пересчитывается через часовой пояс клуба.
-- Окно, переходящее через местную полночь, обрезается по её границе: хвост
-- принадлежит уже следующей дате, и переносить его туда автоматически значило
-- бы придумывать за администратора.

INSERT INTO "HallDaySchedule" ("id", "tenantId", "hallId", "date", "createdAt", "updatedAt")
SELECT DISTINCT
  gen_random_uuid()::text,
  c."tenantId",
  h."id",
  (c."startsAt" AT TIME ZONE t."timezone")::date,
  now(), now()
FROM "TableClosure" AS c
JOIN "Tenant" AS t ON t."id" = c."tenantId"
JOIN "Hall" AS h ON h."tenantId" = c."tenantId";

INSERT INTO "DayClosure" (
  "id", "tenantId", "scheduleId", "tableId",
  "startMinute", "endMinute", "purpose", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  c."tenantId",
  s."id",
  c."tableId",
  EXTRACT(HOUR FROM local_start)::int * 60 + EXTRACT(MINUTE FROM local_start)::int,
  LEAST(
    CASE
      WHEN local_end::date > local_start::date THEN 1440
      ELSE EXTRACT(HOUR FROM local_end)::int * 60 + EXTRACT(MINUTE FROM local_end)::int
    END,
    1440
  ),
  'OTHER'::"ClosurePurpose",
  now(), now()
FROM (
  SELECT
    c.*,
    (c."startsAt" AT TIME ZONE t."timezone") AS local_start,
    (c."endsAt" AT TIME ZONE t."timezone") AS local_end
  FROM "TableClosure" AS c
  JOIN "Tenant" AS t ON t."id" = c."tenantId"
) AS c
JOIN "Hall" AS h ON h."tenantId" = c."tenantId"
JOIN "HallDaySchedule" AS s
  ON s."hallId" = h."id" AND s."date" = c.local_start::date;

DROP TABLE "TableClosure";

-- ---------------------------------------------------------------------------
-- 5. Назначение и тренер у шаблона недели
-- ---------------------------------------------------------------------------

ALTER TABLE "TableClosureRule"
  ADD COLUMN "coachId" TEXT,
  ADD COLUMN "purpose" "ClosurePurpose" NOT NULL DEFAULT 'OTHER';

CREATE INDEX "TableClosureRule_coachId_idx" ON "TableClosureRule"("coachId");

ALTER TABLE "TableClosureRule" ADD CONSTRAINT "TableClosureRule_coachId_tenantId_fkey"
  FOREIGN KEY ("coachId", "tenantId") REFERENCES "CoachProfile"("userId", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DayClosure" ADD CONSTRAINT "DayClosure_coachId_tenantId_fkey"
  FOREIGN KEY ("coachId", "tenantId") REFERENCES "CoachProfile"("userId", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 6. Цены уезжают с клуба
-- ---------------------------------------------------------------------------
--
-- Последним шагом: пока колонки на месте, из них читал INSERT в Hall выше.
-- Констрейнт Tenant_robot_prices_present уходит вместе с колонками.

ALTER TABLE "Tenant"
  DROP COLUMN "bookingStep",
  DROP COLUMN "hasRobotOption",
  DROP COLUMN "robot30MinPrice",
  DROP COLUMN "robot60MinPrice",
  DROP COLUMN "robotExtra30MinPrice",
  DROP COLUMN "tableExtra30MinPrice",
  DROP COLUMN "tableHourPrice";

-- ---------------------------------------------------------------------------
-- 7. Ограничения целостности
-- ---------------------------------------------------------------------------
--
-- Скопированы из prisma/constraints.sql, разделы 12 и 13.

ALTER TABLE "TableClosureRule"
  ADD CONSTRAINT "TableClosureRule_coach_matches_purpose"
  CHECK (
    ("purpose" = 'TRAINING'::"ClosurePurpose" AND "coachId" IS NOT NULL)
    OR "purpose" = 'SPARRING'::"ClosurePurpose"
    OR ("purpose" IN ('RENT'::"ClosurePurpose", 'ROBOT'::"ClosurePurpose", 'OTHER'::"ClosurePurpose")
        AND "coachId" IS NULL)
  );

ALTER TABLE "DayClosure"
  ADD CONSTRAINT "DayClosure_minutes_range"
  CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute");

ALTER TABLE "DayClosure"
  ADD CONSTRAINT "DayClosure_no_overlap"
  EXCLUDE USING gist (
    "tableId" WITH =,
    "scheduleId" WITH =,
    int4range("startMinute", "endMinute", '[)') WITH &&
  );

ALTER TABLE "DayClosure"
  ADD CONSTRAINT "DayClosure_coach_matches_purpose"
  CHECK (
    ("purpose" = 'TRAINING'::"ClosurePurpose" AND "coachId" IS NOT NULL)
    OR "purpose" = 'SPARRING'::"ClosurePurpose"
    OR ("purpose" IN ('RENT'::"ClosurePurpose", 'ROBOT'::"ClosurePurpose", 'OTHER'::"ClosurePurpose")
        AND "coachId" IS NULL)
  );

ALTER TABLE "Hall"
  ADD CONSTRAINT "Hall_robot_prices_present"
  CHECK (
    NOT "hasRobotOption"
    OR ("robot30MinPrice" IS NOT NULL
        AND "robot60MinPrice" IS NOT NULL
        AND "robotExtra30MinPrice" IS NOT NULL)
  );

ALTER TABLE "Hall"
  ADD CONSTRAINT "Hall_prices_non_negative"
  CHECK (
    "tableHourPrice" >= 0
    AND "tableExtra30MinPrice" >= 0
    AND ("robot30MinPrice" IS NULL OR "robot30MinPrice" >= 0)
    AND ("robot60MinPrice" IS NULL OR "robot60MinPrice" >= 0)
    AND ("robotExtra30MinPrice" IS NULL OR "robotExtra30MinPrice" >= 0)
  );
