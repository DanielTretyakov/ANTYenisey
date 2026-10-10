-- Клуб отменяет занятие или турнир, на которое уже записались (решение
-- владельца от 10.10.2026): тренер заболел, зал закрыт. Проведение остаётся
-- историей с отметкой и причиной, записи отменяются с полным возвратом.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'EVENT_CANCELLED';

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "TrainingSession" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMPTZ(3);

-- Отметка и причина — вместе; причина уходит записавшимся в сообщении.
-- То же — в constraints.sql, последний раздел.
ALTER TABLE "TrainingSession"
  ADD CONSTRAINT "TrainingSession_cancel_explained"
  CHECK (
    ("cancelledAt" IS NULL) = ("cancelReason" IS NULL)
    AND ("cancelReason" IS NULL
      OR ("cancelReason" = btrim("cancelReason") AND char_length("cancelReason") BETWEEN 3 AND 300))
  );

ALTER TABLE "Tournament"
  ADD CONSTRAINT "Tournament_cancel_explained"
  CHECK (
    ("cancelledAt" IS NULL) = ("cancelReason" IS NULL)
    AND ("cancelReason" IS NULL
      OR ("cancelReason" = btrim("cancelReason") AND char_length("cancelReason") BETWEEN 3 AND 300))
  );
