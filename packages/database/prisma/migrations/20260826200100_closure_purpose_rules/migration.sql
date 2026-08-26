-- Правила: кто и что прикрепляется к окну расписания.
--
-- Отдельной миграцией от предыдущей намеренно: Postgres не даёт использовать
-- значение enum в том же транзакционном блоке, где оно добавлено, а Prisma
-- выполняет каждую миграцию одной транзакцией.

ALTER TABLE "TableClosureRule" DROP CONSTRAINT "TableClosureRule_people_match_purpose";
ALTER TABLE "DayClosure" DROP CONSTRAINT "DayClosure_people_match_purpose";

-- Шаблон недели описывает, как зал живёт обычно, и турниру там места нет: у
-- турнира конкретная дата, а «каждую субботу один и тот же турнир» — это не
-- турнир, а серия разных.
ALTER TABLE "TableClosureRule"
  ADD CONSTRAINT "TableClosureRule_no_tournament"
  CHECK ("purpose" <> 'TOURNAMENT'::"ClosurePurpose");

ALTER TABLE "TableClosureRule"
  ADD CONSTRAINT "TableClosureRule_attachments_match_purpose"
  CHECK (
    ("purpose" = 'TRAINING'::"ClosurePurpose"
       AND "coachId" IS NOT NULL AND "clientId" IS NULL AND "trainingTypeId" IS NOT NULL)
    OR ("purpose" = 'SPARRING'::"ClosurePurpose"
       AND "clientId" IS NULL AND "trainingTypeId" IS NULL)
    OR ("purpose" IN ('RENT'::"ClosurePurpose", 'ROBOT'::"ClosurePurpose")
       AND "coachId" IS NULL AND "trainingTypeId" IS NULL)
    OR ("purpose" = 'OTHER'::"ClosurePurpose"
       AND "coachId" IS NULL AND "clientId" IS NULL AND "trainingTypeId" IS NULL)
  );

ALTER TABLE "DayClosure"
  ADD CONSTRAINT "DayClosure_attachments_match_purpose"
  CHECK (
    ("purpose" = 'TRAINING'::"ClosurePurpose"
       AND "coachId" IS NOT NULL AND "clientId" IS NULL
       AND "trainingTypeId" IS NOT NULL AND "tournamentId" IS NULL)
    OR ("purpose" = 'SPARRING'::"ClosurePurpose"
       AND "clientId" IS NULL AND "trainingTypeId" IS NULL AND "tournamentId" IS NULL)
    OR ("purpose" IN ('RENT'::"ClosurePurpose", 'ROBOT'::"ClosurePurpose")
       AND "coachId" IS NULL AND "trainingTypeId" IS NULL AND "tournamentId" IS NULL)
    OR ("purpose" = 'TOURNAMENT'::"ClosurePurpose"
       AND "coachId" IS NULL AND "clientId" IS NULL
       AND "trainingTypeId" IS NULL AND "tournamentId" IS NOT NULL)
    OR ("purpose" = 'OTHER'::"ClosurePurpose"
       AND "coachId" IS NULL AND "clientId" IS NULL
       AND "trainingTypeId" IS NULL AND "tournamentId" IS NULL)
  );
