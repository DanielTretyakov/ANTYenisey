-- Приветствие клуба и прочтение ленты (решение владельца от 30.09.2026).

-- AlterTable
ALTER TABLE "ClubPost" ADD COLUMN     "autoBody" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "welcome" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "authorId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ClubPostRead" (
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "readAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubPostRead_pkey" PRIMARY KEY ("userId","postId")
);

-- CreateIndex
CREATE INDEX "ClubPostRead_postId_idx" ON "ClubPostRead"("postId");

-- AddForeignKey
ALTER TABLE "ClubPostRead" ADD CONSTRAINT "ClubPostRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubPostRead" ADD CONSTRAINT "ClubPostRead_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ClubPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ограничения — раздел 34 constraints.sql.
ALTER TABLE "ClubPost"
  ADD CONSTRAINT "ClubPost_welcome_shape"
  CHECK (("welcome" OR "authorId" IS NOT NULL) AND (NOT "autoBody" OR "welcome"));

CREATE UNIQUE INDEX "ClubPost_one_welcome"
  ON "ClubPost" ("tenantId")
  WHERE "welcome";

-- Приветствие каждому клубу: текст собирается из данных клуба при чтении,
-- в `body` — только снимок, чтобы строка прошла CHECK непустого текста.
INSERT INTO "ClubPost" ("id", "tenantId", "authorId", "title", "body", "publishedAt", "welcome", "autoBody", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text,
       t."id",
       NULL,
       left('Добро пожаловать в «' || t."name" || '»', 160),
       'Добро пожаловать!',
       now(),
       true,
       true,
       now(),
       now()
  FROM "Tenant" t
 WHERE NOT EXISTS (SELECT 1 FROM "ClubPost" p WHERE p."tenantId" = t."id" AND p."welcome");
