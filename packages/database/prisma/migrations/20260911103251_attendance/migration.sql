-- Отметка присутствия: окончание турнира, начало учёта у клуба, визит без
-- автора у автонеявки. Правлено руками: Prisma добавляет обязательные колонки
-- сразу NOT NULL и падает на непустых таблицах, поэтому здесь порядок
-- «добавить пустой → заполнить → запретить пустое».

-- AlterTable
--
-- Момент миграции и становится началом учёта у существующих клубов: всё, что
-- закончилось раньше, джоба автонеявки не тронет никогда.
ALTER TABLE "Tenant" ADD COLUMN     "attendanceTrackedSince" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "endsAt" TIMESTAMPTZ(3);

-- Окончание — по концу окон турнира в расписании дня, в поясе его зала.
-- Турниру без окон (или с окнами, кончающимися не позже начала) — начало
-- плюс четыре часа: так идут турниры «Енисея».
UPDATE "Tournament" t
SET "endsAt" = w.ends
FROM (
  SELECT dc."tournamentId" AS id,
         max((s."date" + make_interval(mins => dc."endMinute")) AT TIME ZONE h.timezone) AS ends
  FROM "DayClosure" dc
  JOIN "HallDaySchedule" s ON s.id = dc."scheduleId"
  JOIN "Hall" h ON h.id = s."hallId"
  WHERE dc."tournamentId" IS NOT NULL
  GROUP BY dc."tournamentId"
) w
WHERE t.id = w.id AND w.ends > t."startsAt";

UPDATE "Tournament" SET "endsAt" = "startsAt" + interval '4 hours' WHERE "endsAt" IS NULL;

ALTER TABLE "Tournament" ALTER COLUMN "endsAt" SET NOT NULL;

-- AlterTable
ALTER TABLE "VisitLog" ADD COLUMN     "note" TEXT,
ADD COLUMN     "visitedAt" TIMESTAMPTZ(3),
ALTER COLUMN "recordedByUserId" DROP NOT NULL;

-- Визитов до этой миграции не заводил ни один сервис, но колонка
-- заполняется честно: момент записи — лучшее, что о таком визите известно.
UPDATE "VisitLog" SET "visitedAt" = "recordedAt" AT TIME ZONE 'UTC' WHERE "visitedAt" IS NULL;

ALTER TABLE "VisitLog" ALTER COLUMN "visitedAt" SET NOT NULL;

-- CreateIndex
CREATE INDEX "VisitLog_tenantId_visitedAt_idx" ON "VisitLog"("tenantId", "visitedAt");

-- ---------------------------------------------------------------------------
-- Ограничения целостности (Prisma их не выражает) — раздел 3 и раздел 17
-- constraints.sql
-- ---------------------------------------------------------------------------

ALTER TABLE "Tournament"
  ADD CONSTRAINT "Tournament_time_order" CHECK ("endsAt" > "startsAt");

-- Источник визита соответствует типу строже прежнего: у визита по записи
-- заполнена ровно своя ссылка, визит без записи — только WALK_IN.
ALTER TABLE "VisitLog" DROP CONSTRAINT "VisitLog_source_matches_type";

ALTER TABLE "VisitLog"
  ADD CONSTRAINT "VisitLog_source_matches_type"
  CHECK (
    CASE "sourceType"
      WHEN 'TRAINING' THEN "trainingBookingId" IS NOT NULL
                      AND "tournamentRegistrationId" IS NULL
                      AND "tableBookingId" IS NULL
      WHEN 'TOURNAMENT' THEN "tournamentRegistrationId" IS NOT NULL
                        AND "trainingBookingId" IS NULL
                        AND "tableBookingId" IS NULL
      WHEN 'TABLE' THEN "tableBookingId" IS NOT NULL
                   AND "trainingBookingId" IS NULL
                   AND "tournamentRegistrationId" IS NULL
      WHEN 'WALK_IN' THEN "trainingBookingId" IS NULL
                     AND "tournamentRegistrationId" IS NULL
                     AND "tableBookingId" IS NULL
    END
  );

-- Одна запись — один визит; визит с порога — не дважды в один момент.
CREATE UNIQUE INDEX "VisitLog_training_booking_uniq"
  ON "VisitLog" ("trainingBookingId")
  WHERE "trainingBookingId" IS NOT NULL;

CREATE UNIQUE INDEX "VisitLog_tournament_registration_uniq"
  ON "VisitLog" ("tournamentRegistrationId")
  WHERE "tournamentRegistrationId" IS NOT NULL;

CREATE UNIQUE INDEX "VisitLog_table_booking_uniq"
  ON "VisitLog" ("tableBookingId")
  WHERE "tableBookingId" IS NOT NULL;

CREATE UNIQUE INDEX "VisitLog_walk_in_uniq"
  ON "VisitLog" ("tenantId", "clientId", "visitedAt")
  WHERE "sourceType" = 'WALK_IN'::"VisitSourceType";

ALTER TABLE "VisitLog"
  ADD CONSTRAINT "VisitLog_walk_in_attended"
  CHECK ("sourceType" <> 'WALK_IN'::"VisitSourceType" OR attended);

-- Без автора — только неявка по записи, поставленная джобой.
ALTER TABLE "VisitLog"
  ADD CONSTRAINT "VisitLog_author_unless_auto_no_show"
  CHECK (
    "recordedByUserId" IS NOT NULL
    OR (NOT attended AND "sourceType" <> 'WALK_IN'::"VisitSourceType")
  );

-- Отмеченная запись несёт процент списания — снимок в момент отметки.
ALTER TABLE "TableBooking"
  ADD CONSTRAINT "TableBooking_marked_has_ratio"
  CHECK ("status" NOT IN ('ATTENDED'::"BookingStatus", 'NO_SHOW'::"BookingStatus") OR "chargeRatio" IS NOT NULL);

ALTER TABLE "TrainingBooking"
  ADD CONSTRAINT "TrainingBooking_marked_has_ratio"
  CHECK ("status" NOT IN ('ATTENDED'::"BookingStatus", 'NO_SHOW'::"BookingStatus") OR "chargeRatio" IS NOT NULL);

ALTER TABLE "TournamentRegistration"
  ADD CONSTRAINT "TournamentRegistration_marked_has_ratio"
  CHECK ("status" NOT IN ('ATTENDED'::"BookingStatus", 'NO_SHOW'::"BookingStatus") OR "chargeRatio" IS NOT NULL);

-- Журнал аудита — только вставки: правка строки журнала лишает его
-- доказательной силы в споре о деньгах.
CREATE FUNCTION "AuditLog_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog — журнал только для вставок, % запрещён', TG_OP
    USING ERRCODE = '23001';
END
$$;

CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "AuditLog_reject_change"();

CREATE TRIGGER "AuditLog_no_truncate"
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION "AuditLog_reject_change"();
