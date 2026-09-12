-- Клиент у окна расписания снят. Окно не несёт ни цены, ни статуса, ни
-- отмены, а человек, которого администратор вписывал кистью «Аренда»,
-- считал себя записанным и не видел записи у себя в кабинете. Время,
-- закреплённое за человеком, теперь бронь (TableBooking).
--
-- Строк с заполненным clientId в базе нет — проверено перед миграцией.

/*
  Warnings:

  - You are about to drop the column `clientId` on the `DayClosure` table. All the data in the column will be lost.
  - You are about to drop the column `clientId` on the `TableClosureRule` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "DayClosure" DROP CONSTRAINT "DayClosure_clientId_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "TableClosureRule" DROP CONSTRAINT "TableClosureRule_clientId_tenantId_fkey";

-- DropIndex
DROP INDEX "DayClosure_clientId_idx";

-- DropIndex
DROP INDEX "TableClosureRule_clientId_idx";

-- AlterTable
ALTER TABLE "DayClosure" DROP COLUMN "clientId";

-- AlterTable
ALTER TABLE "TableClosureRule" DROP COLUMN "clientId";

-- ---------------------------------------------------------------------------
-- Ограничения целостности — раздел 12 constraints.sql
-- ---------------------------------------------------------------------------
--
-- DROP COLUMN молча уносит с собой каждый CHECK, который на колонку
-- ссылается, — оба правила «что прикрепляется к окну» исчезли бы вместе с
-- clientId и никто бы не заметил. Возвращаем их без него.

ALTER TABLE "TableClosureRule"
  ADD CONSTRAINT "TableClosureRule_attachments_match_purpose"
  CHECK (
    ("purpose" = 'TRAINING'::"ClosurePurpose"
       AND "coachId" IS NOT NULL
       AND "trainingTypeId" IS NOT NULL AND "tournamentTypeId" IS NULL)
    OR ("purpose" = 'SPARRING'::"ClosurePurpose"
       AND "trainingTypeId" IS NULL AND "tournamentTypeId" IS NULL)
    OR ("purpose" IN ('RENT'::"ClosurePurpose", 'ROBOT'::"ClosurePurpose")
       AND "coachId" IS NULL AND "trainingTypeId" IS NULL AND "tournamentTypeId" IS NULL)
    OR ("purpose" = 'TOURNAMENT'::"ClosurePurpose"
       AND "coachId" IS NULL
       AND "trainingTypeId" IS NULL AND "tournamentTypeId" IS NOT NULL)
    OR ("purpose" = 'OTHER'::"ClosurePurpose"
       AND "coachId" IS NULL
       AND "trainingTypeId" IS NULL AND "tournamentTypeId" IS NULL)
  );

ALTER TABLE "DayClosure"
  ADD CONSTRAINT "DayClosure_attachments_match_purpose"
  CHECK (
    ("purpose" = 'TRAINING'::"ClosurePurpose"
       AND "coachId" IS NOT NULL
       AND "trainingTypeId" IS NOT NULL AND "tournamentId" IS NULL)
    OR ("purpose" = 'SPARRING'::"ClosurePurpose"
       AND "trainingTypeId" IS NULL AND "tournamentId" IS NULL
       AND "trainingSessionId" IS NULL)
    OR ("purpose" IN ('RENT'::"ClosurePurpose", 'ROBOT'::"ClosurePurpose")
       AND "coachId" IS NULL AND "trainingTypeId" IS NULL AND "tournamentId" IS NULL
       AND "trainingSessionId" IS NULL)
    OR ("purpose" = 'TOURNAMENT'::"ClosurePurpose"
       AND "coachId" IS NULL
       AND "trainingTypeId" IS NULL AND "tournamentId" IS NOT NULL
       AND "trainingSessionId" IS NULL)
    OR ("purpose" = 'OTHER'::"ClosurePurpose"
       AND "coachId" IS NULL
       AND "trainingTypeId" IS NULL AND "tournamentId" IS NULL
       AND "trainingSessionId" IS NULL)
  );
