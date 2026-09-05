-- Занятие в расписании дня: окно стола ссылается на конкретную сессию.
--
-- До этой миграции закрытие с purpose = TRAINING знало только тренера и тип
-- тренировки, а сессия, на которую идёт запись клиента, жила отдельно и ни с
-- каким временем стола связана не была. Два независимых списка одного и того
-- же занятия расходятся молча: администратор убирает занятие из расписания, а
-- запись на него остаётся открытой.
--
-- Ссылка НЕ обязательна даже при purpose = TRAINING: администратор законно
-- закрывает стол под индивидуальное занятие, на которое никто не
-- записывается, и требовать для него сессию с лимитом мест не за чем.
--
-- В шаблоне недели (TableClosureRule) такого поля нет по той же причине, что и
-- у турнира: шаблон повторяется каждую неделю, а у сессии конкретная дата.

ALTER TABLE "DayClosure" ADD COLUMN "trainingSessionId" TEXT;

ALTER TABLE "DayClosure"
  ADD CONSTRAINT "DayClosure_trainingSessionId_tenantId_fkey"
  FOREIGN KEY ("trainingSessionId", "tenantId")
  REFERENCES "TrainingSession"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "DayClosure_trainingSessionId_idx" ON "DayClosure"("trainingSessionId");

-- Правило согласованности переписывается целиком: добавить ветку к
-- существующему CHECK нельзя, его можно только снять и создать заново.
ALTER TABLE "DayClosure" DROP CONSTRAINT "DayClosure_attachments_match_purpose";

ALTER TABLE "DayClosure"
  ADD CONSTRAINT "DayClosure_attachments_match_purpose"
  CHECK (
    ("purpose" = 'TRAINING'::"ClosurePurpose"
       AND "coachId" IS NOT NULL AND "clientId" IS NULL
       AND "trainingTypeId" IS NOT NULL AND "tournamentId" IS NULL)
    OR ("purpose" = 'SPARRING'::"ClosurePurpose"
       AND "clientId" IS NULL AND "trainingTypeId" IS NULL AND "tournamentId" IS NULL
       AND "trainingSessionId" IS NULL)
    OR ("purpose" IN ('RENT'::"ClosurePurpose", 'ROBOT'::"ClosurePurpose")
       AND "coachId" IS NULL AND "trainingTypeId" IS NULL AND "tournamentId" IS NULL
       AND "trainingSessionId" IS NULL)
    OR ("purpose" = 'TOURNAMENT'::"ClosurePurpose"
       AND "coachId" IS NULL AND "clientId" IS NULL
       AND "trainingTypeId" IS NULL AND "tournamentId" IS NOT NULL
       AND "trainingSessionId" IS NULL)
    OR ("purpose" = 'OTHER'::"ClosurePurpose"
       AND "coachId" IS NULL AND "clientId" IS NULL
       AND "trainingTypeId" IS NULL AND "tournamentId" IS NULL
       AND "trainingSessionId" IS NULL)
  );
