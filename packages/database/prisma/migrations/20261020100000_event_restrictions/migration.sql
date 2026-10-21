-- Кто может записаться на мероприятие (решения владельца от 20.10.2026):
-- возраст и пол у вида занятия и турнира, система рейтинга у планки турнира.
-- Существующие виды остаются открытыми всем — все поля пусты.

-- CreateEnum
CREATE TYPE "RatingSystem" AS ENUM ('RTTW', 'RTTF', 'FNTR');

-- AlterTable
ALTER TABLE "TrainingType"
  ADD COLUMN "minAge" INTEGER,
  ADD COLUMN "maxAge" INTEGER,
  ADD COLUMN "gender" "Gender";

-- AlterTable
ALTER TABLE "TournamentType"
  ADD COLUMN "ratingSystem" "RatingSystem",
  ADD COLUMN "minAge" INTEGER,
  ADD COLUMN "maxAge" INTEGER,
  ADD COLUMN "gender" "Gender";

-- Те же правила, что в constraints.sql (раздел «Кто может записаться»).
ALTER TABLE "TrainingType"
  ADD CONSTRAINT "TrainingType_restrictions_sane"
  CHECK (
    ("minAge" IS NULL OR "minAge" BETWEEN 0 AND 120)
    AND ("maxAge" IS NULL OR "maxAge" BETWEEN 0 AND 120)
    AND ("minAge" IS NULL OR "maxAge" IS NULL OR "minAge" <= "maxAge")
  );

ALTER TABLE "TournamentType"
  ADD CONSTRAINT "TournamentType_restrictions_sane"
  CHECK (
    ("minAge" IS NULL OR "minAge" BETWEEN 0 AND 120)
    AND ("maxAge" IS NULL OR "maxAge" BETWEEN 0 AND 120)
    AND ("minAge" IS NULL OR "maxAge" IS NULL OR "minAge" <= "maxAge")
    AND ("ratingSystem" IS NULL OR "ratingLabel" IS NOT NULL)
  );
