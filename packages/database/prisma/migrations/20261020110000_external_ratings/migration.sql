-- Рейтинги игрока во внешних системах — ФНТР, RTTW, RTTF (решения владельца
-- от 20.10.2026). Заполняет ежедневная сверка; таблица производная, каскад с
-- учёткой.

-- CreateTable
CREATE TABLE "ExternalRating" (
    "userId" TEXT NOT NULL,
    "system" "RatingSystem" NOT NULL,
    "externalId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "place" INTEGER,
    "asOf" DATE,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalRating_pkey" PRIMARY KEY ("userId","system")
);

-- CreateIndex
CREATE INDEX "ExternalRating_system_externalId_idx" ON "ExternalRating"("system", "externalId");

-- AddForeignKey
ALTER TABLE "ExternalRating" ADD CONSTRAINT "ExternalRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Тот же CHECK, что в constraints.sql.
ALTER TABLE "ExternalRating"
  ADD CONSTRAINT "ExternalRating_values_sane"
  CHECK (
    "rating" BETWEEN 0 AND 100000
    AND ("place" IS NULL OR "place" > 0)
    AND "externalId" ~ '^[0-9A-Za-z_-]{1,40}$'
  );
