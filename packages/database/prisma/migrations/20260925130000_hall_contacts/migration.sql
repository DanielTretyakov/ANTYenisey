-- Телефон и почта зала (решение владельца от 25.09.2026): у залов в разных
-- городах свои администраторы. Ограничения — те же, что в разделе 28
-- constraints.sql.
ALTER TABLE "Hall" ADD COLUMN "phone" TEXT,
ADD COLUMN "email" TEXT;

ALTER TABLE "Hall"
  ADD CONSTRAINT "Hall_phone_format"
  CHECK ("phone" IS NULL OR "phone" ~ '^\+7[0-9]{10}$');

ALTER TABLE "Hall"
  ADD CONSTRAINT "Hall_email_format"
  CHECK ("email" IS NULL OR (char_length("email") <= 200 AND "email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));
