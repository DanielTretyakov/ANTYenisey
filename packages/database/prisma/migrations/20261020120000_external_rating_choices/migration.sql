-- «Выберите себя» (решение владельца от 20.10.2026): когда под ФИО и год
-- нашлись несколько игроков источника, человек сам закрепляет своего.

-- AlterTable
ALTER TABLE "ExternalRating" ADD COLUMN "claimedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ExternalRatingChoice" (
    "userId" TEXT NOT NULL,
    "system" "RatingSystem" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "birthYear" INTEGER,
    "rating" INTEGER NOT NULL,
    "place" INTEGER,
    "asOf" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalRatingChoice_pkey" PRIMARY KEY ("userId","system","externalId")
);

-- AddForeignKey
ALTER TABLE "ExternalRatingChoice" ADD CONSTRAINT "ExternalRatingChoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Те же правила, что в constraints.sql.
CREATE UNIQUE INDEX "ExternalRating_one_claim"
  ON "ExternalRating" ("system", "externalId")
  WHERE "claimedAt" IS NOT NULL;

ALTER TABLE "ExternalRatingChoice"
  ADD CONSTRAINT "ExternalRatingChoice_values_sane"
  CHECK (
    "rating" BETWEEN 0 AND 100000
    AND ("place" IS NULL OR "place" > 0)
    AND "externalId" ~ '^[0-9A-Za-z_-]{1,40}$'
    AND btrim("name") <> '' AND char_length("name") <= 200
    AND ("birthYear" IS NULL OR "birthYear" BETWEEN 1900 AND 2100)
  );
