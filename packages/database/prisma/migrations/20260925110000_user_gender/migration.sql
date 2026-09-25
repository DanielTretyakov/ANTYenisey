-- Пол человека — для рисованной заглушки аватара (решение владельца от
-- 25.09.2026). Необязателен в базе: у учёток, заведённых раньше, его нет.
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

ALTER TABLE "User" ADD COLUMN "gender" "Gender";
