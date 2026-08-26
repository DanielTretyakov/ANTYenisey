-- Классификация тренировок и турниры в расписании.
--
-- У окна расписания появляются две новые привязки:
--   * тип тренировки — «Общая групповая», «Первая подача»: от него зависит
--     цена, а «просто тренировка» в расписании не говорит клиенту ничего;
--   * турнир — новое назначение TOURNAMENT.
--
-- Турнир возможен ТОЛЬКО в расписании конкретной даты. У него дата и время
-- проведения, и в постоянном шаблоне недели ему места нет: «каждую субботу
-- один и тот же турнир» — это не турнир, а серия разных.

ALTER TYPE "ClosurePurpose" ADD VALUE 'TOURNAMENT';

ALTER TABLE "TableClosureRule" ADD COLUMN "trainingTypeId" TEXT;
ALTER TABLE "DayClosure" ADD COLUMN "trainingTypeId" TEXT;
ALTER TABLE "DayClosure" ADD COLUMN "tournamentId" TEXT;

CREATE INDEX "TableClosureRule_trainingTypeId_idx" ON "TableClosureRule"("trainingTypeId");
CREATE INDEX "DayClosure_trainingTypeId_idx" ON "DayClosure"("trainingTypeId");
CREATE INDEX "DayClosure_tournamentId_idx" ON "DayClosure"("tournamentId");

ALTER TABLE "TableClosureRule" ADD CONSTRAINT "TableClosureRule_trainingTypeId_tenantId_fkey"
  FOREIGN KEY ("trainingTypeId", "tenantId") REFERENCES "TrainingType"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DayClosure" ADD CONSTRAINT "DayClosure_trainingTypeId_tenantId_fkey"
  FOREIGN KEY ("trainingTypeId", "tenantId") REFERENCES "TrainingType"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DayClosure" ADD CONSTRAINT "DayClosure_tournamentId_tenantId_fkey"
  FOREIGN KEY ("tournamentId", "tenantId") REFERENCES "Tournament"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
