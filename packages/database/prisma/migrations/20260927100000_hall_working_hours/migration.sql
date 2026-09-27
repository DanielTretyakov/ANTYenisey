-- Часы работы зала (решение владельца от 27.09.2026): семь дней с
-- понедельника, день — {open, close} или null. Пусто — не указаны.

-- AlterTable
ALTER TABLE "Hall" ADD COLUMN     "workingHours" JSONB;

-- CHECK — тот же, что в constraints.sql, раздел 33.
ALTER TABLE "Hall"
  ADD CONSTRAINT "Hall_working_hours_shape"
  CHECK (
    "workingHours" IS NULL
    OR (jsonb_typeof("workingHours") = 'array' AND jsonb_array_length("workingHours") = 7)
  );
