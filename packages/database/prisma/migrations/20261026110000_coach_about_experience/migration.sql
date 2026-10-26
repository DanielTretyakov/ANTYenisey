-- «Обо мне» и год начала тренерского стажа в карточке тренера (решение
-- владельца от 26.10.2026). Ограничения — те же, что в constraints.sql.
ALTER TABLE "CoachCard" ADD COLUMN "about" TEXT;
ALTER TABLE "CoachCard" ADD COLUMN "coachingSince" INTEGER;

ALTER TABLE "CoachCard"
  ADD CONSTRAINT "CoachCard_about_filled"
  CHECK ("about" IS NULL OR ("about" = btrim("about") AND char_length("about") BETWEEN 1 AND 2000));

ALTER TABLE "CoachCard"
  ADD CONSTRAINT "CoachCard_coaching_since_sane"
  CHECK ("coachingSince" IS NULL OR "coachingSince" BETWEEN 1950 AND 2100);
