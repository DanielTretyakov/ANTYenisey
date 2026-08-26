-- Тип турнира в шаблоне недели.
--
-- Раньше турнир в постоянном шаблоне был запрещён: у турнира конкретная дата,
-- и из шаблона его не создать. Довод верный, но он против хранения САМОГО
-- турнира, а не его типа. «Каждую субботу с 10:00 идёт турнир» — законное
-- описание жизни клуба; конкретное проведение с датой заводится, когда
-- администратор открывает эту дату и сохраняет её расписание.

ALTER TABLE "TableClosureRule" ADD COLUMN "tournamentTypeId" TEXT;

CREATE INDEX "TableClosureRule_tournamentTypeId_idx" ON "TableClosureRule"("tournamentTypeId");

ALTER TABLE "TableClosureRule" ADD CONSTRAINT "TableClosureRule_tournamentTypeId_tenantId_fkey"
  FOREIGN KEY ("tournamentTypeId", "tenantId") REFERENCES "TournamentType"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TableClosureRule" DROP CONSTRAINT "TableClosureRule_no_tournament";
ALTER TABLE "TableClosureRule" DROP CONSTRAINT "TableClosureRule_attachments_match_purpose";

ALTER TABLE "TableClosureRule"
  ADD CONSTRAINT "TableClosureRule_attachments_match_purpose"
  CHECK (
    ("purpose" = 'TRAINING'::"ClosurePurpose"
       AND "coachId" IS NOT NULL AND "clientId" IS NULL
       AND "trainingTypeId" IS NOT NULL AND "tournamentTypeId" IS NULL)
    OR ("purpose" = 'SPARRING'::"ClosurePurpose"
       AND "clientId" IS NULL AND "trainingTypeId" IS NULL AND "tournamentTypeId" IS NULL)
    OR ("purpose" IN ('RENT'::"ClosurePurpose", 'ROBOT'::"ClosurePurpose")
       AND "coachId" IS NULL AND "trainingTypeId" IS NULL AND "tournamentTypeId" IS NULL)
    OR ("purpose" = 'TOURNAMENT'::"ClosurePurpose"
       AND "coachId" IS NULL AND "clientId" IS NULL
       AND "trainingTypeId" IS NULL AND "tournamentTypeId" IS NOT NULL)
    OR ("purpose" = 'OTHER'::"ClosurePurpose"
       AND "coachId" IS NULL AND "clientId" IS NULL
       AND "trainingTypeId" IS NULL AND "tournamentTypeId" IS NULL)
  );
