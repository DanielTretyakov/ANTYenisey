-- Описание мероприятия для окна подробностей — у типа занятия и типа турнира,
-- а не у проведения (решение владельца от 24.09.2026).

ALTER TABLE "TrainingType" ADD COLUMN "description" TEXT;
ALTER TABLE "TournamentType" ADD COLUMN "description" TEXT;

-- Ограничения — те же, что в разделе 24 constraints.sql.
ALTER TABLE "TrainingType"
  ADD CONSTRAINT "TrainingType_description_sane"
  CHECK ("description" IS NULL OR ("description" = btrim("description") AND char_length("description") BETWEEN 1 AND 2000));

ALTER TABLE "TournamentType"
  ADD CONSTRAINT "TournamentType_description_sane"
  CHECK ("description" IS NULL OR ("description" = btrim("description") AND char_length("description") BETWEEN 1 AND 2000));
