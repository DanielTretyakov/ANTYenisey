-- Клиент, закреплённый за окном расписания.
--
-- Раньше к окну можно было прикрепить только тренера, и аренда с роботом
-- оставались безымянными: в сетке было видно, что стол занят, но не кем.
-- Аренда и робот закрепляются за КЛИЕНТОМ — это он занял стол.
--
-- Перекрёстные поля запрещены, а не просто необязательны: тренер у аренды
-- набрал бы в статистику чужие часы, а «закреплённый клиент» у тренировки, где
-- участников десяток, ввёл бы в заблуждение.

ALTER TABLE "TableClosureRule" ADD COLUMN "clientId" TEXT;
ALTER TABLE "DayClosure" ADD COLUMN "clientId" TEXT;

CREATE INDEX "TableClosureRule_clientId_idx" ON "TableClosureRule"("clientId");
CREATE INDEX "DayClosure_clientId_idx" ON "DayClosure"("clientId");

ALTER TABLE "TableClosureRule" ADD CONSTRAINT "TableClosureRule_clientId_tenantId_fkey"
  FOREIGN KEY ("clientId", "tenantId") REFERENCES "ClientProfile"("userId", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DayClosure" ADD CONSTRAINT "DayClosure_clientId_tenantId_fkey"
  FOREIGN KEY ("clientId", "tenantId") REFERENCES "ClientProfile"("userId", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Прежнее правило знало только про тренера — заменяем целиком.
ALTER TABLE "TableClosureRule" DROP CONSTRAINT "TableClosureRule_coach_matches_purpose";
ALTER TABLE "DayClosure" DROP CONSTRAINT "DayClosure_coach_matches_purpose";

ALTER TABLE "TableClosureRule"
  ADD CONSTRAINT "TableClosureRule_people_match_purpose"
  CHECK (
    ("purpose" = 'TRAINING'::"ClosurePurpose"
       AND "coachId" IS NOT NULL AND "clientId" IS NULL)
    OR ("purpose" = 'SPARRING'::"ClosurePurpose" AND "clientId" IS NULL)
    OR ("purpose" IN ('RENT'::"ClosurePurpose", 'ROBOT'::"ClosurePurpose")
       AND "coachId" IS NULL)
    OR ("purpose" = 'OTHER'::"ClosurePurpose"
       AND "coachId" IS NULL AND "clientId" IS NULL)
  );

ALTER TABLE "DayClosure"
  ADD CONSTRAINT "DayClosure_people_match_purpose"
  CHECK (
    ("purpose" = 'TRAINING'::"ClosurePurpose"
       AND "coachId" IS NOT NULL AND "clientId" IS NULL)
    OR ("purpose" = 'SPARRING'::"ClosurePurpose" AND "clientId" IS NULL)
    OR ("purpose" IN ('RENT'::"ClosurePurpose", 'ROBOT'::"ClosurePurpose")
       AND "coachId" IS NULL)
    OR ("purpose" = 'OTHER'::"ClosurePurpose"
       AND "coachId" IS NULL AND "clientId" IS NULL)
  );
