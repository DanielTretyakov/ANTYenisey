-- Заявки клубов на подключение к КНТ — форма «Подключить свой клуб»
-- (решение владельца от 03.10.2026) — и сообщение о них владельцу платформы.

-- CreateEnum
CREATE TYPE "ClubApplicationStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'CONNECTED', 'DECLINED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CLUB_APPLICATION';

-- CreateTable
CREATE TABLE "ClubApplication" (
    "id" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "clubName" TEXT NOT NULL,
    "cityId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "halls" INTEGER,
    "tables" INTEGER,
    "comment" TEXT,
    "status" "ClubApplicationStatus" NOT NULL DEFAULT 'NEW',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClubApplication_status_createdAt_idx" ON "ClubApplication"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ClubApplication" ADD CONSTRAINT "ClubApplication_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ограничения, которых Prisma не выражает (повторены в constraints.sql).
ALTER TABLE "ClubApplication"
  ADD CONSTRAINT "ClubApplication_contact_present"
  CHECK ("phone" IS NOT NULL OR "email" IS NOT NULL);

ALTER TABLE "ClubApplication"
  ADD CONSTRAINT "ClubApplication_sane"
  CHECK (
    "contactName" = btrim("contactName") AND char_length("contactName") BETWEEN 2 AND 100
    AND "clubName" = btrim("clubName") AND char_length("clubName") BETWEEN 2 AND 120
    AND ("phone" IS NULL OR "phone" ~ '^\+7[0-9]{10}$')
    AND ("email" IS NULL OR ("email" ~ '^[^@[:space:]]+@[^@[:space:]]+$' AND char_length("email") <= 254))
    AND ("halls" IS NULL OR "halls" BETWEEN 1 AND 100)
    AND ("tables" IS NULL OR "tables" BETWEEN 1 AND 1000)
    AND ("comment" IS NULL OR char_length("comment") BETWEEN 1 AND 2000)
    AND ("note" IS NULL OR char_length("note") <= 2000)
  );
