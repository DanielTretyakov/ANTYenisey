-- Новости платформы (решение владельца от 26.09.2026): пишет владелец
-- платформы, читают все, раздел «Для клубов» — только сотрудники клубов.

-- CreateEnum
CREATE TYPE "NewsSection" AS ENUM ('GENERAL', 'UPDATES', 'CLUBS');

-- CreateTable
CREATE TABLE "PlatformNews" (
    "id" TEXT NOT NULL,
    "section" "NewsSection" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformNews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformNews_publishedAt_idx" ON "PlatformNews"("publishedAt");

-- CreateIndex
CREATE INDEX "PlatformNews_section_publishedAt_idx" ON "PlatformNews"("section", "publishedAt");

-- AddForeignKey
ALTER TABLE "PlatformNews" ADD CONSTRAINT "PlatformNews_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECK — те же, что в constraints.sql, раздел 31.
ALTER TABLE "PlatformNews"
  ADD CONSTRAINT "PlatformNews_title_sane"
  CHECK (btrim("title") <> '' AND char_length("title") <= 160);

ALTER TABLE "PlatformNews"
  ADD CONSTRAINT "PlatformNews_body_sane"
  CHECK (btrim("body") <> '' AND char_length("body") <= 20000);
