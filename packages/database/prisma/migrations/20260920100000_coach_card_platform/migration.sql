-- Карточка тренера переезжает с клуба на человека; цены остаются клубными.
--
-- Решение владельца от 20.09.2026: у тренера один профиль на платформу, как у
-- игрока, и заполняет его он сам. Клуб карточку больше не правит — отступление
-- от ТЗ, записано в docs/DEVELOPMENT.md. Клубным осталось то, что у клубов
-- действительно разное: цены за групповую и индивидуальную тренировку.
--
-- Порядок важен: сначала новая таблица и перенос, потом снятие колонок.

-- CreateTable
CREATE TABLE "CoachCard" (
    "userId" TEXT NOT NULL,
    "photoFileId" TEXT,
    "achievements" TEXT,
    "inventory" TEXT,
    "socialLinks" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachCard_pkey" PRIMARY KEY ("userId")
);

CREATE UNIQUE INDEX "CoachCard_photoFileId_key" ON "CoachCard"("photoFileId");

ALTER TABLE "CoachCard" ADD CONSTRAINT "CoachCard_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- NoAction, а не Restrict: карточка теперь прямой потомок учётки и исчезает в
-- одной волне каскада с файлом — та же причина, что у аватара игрока. Отложенная
-- проверка, которая была нужна клубной карточке, больше не требуется.
ALTER TABLE "CoachCard" ADD CONSTRAINT "CoachCard_photoFileId_userId_fkey"
  FOREIGN KEY ("photoFileId", "userId") REFERENCES "StoredFile"("id", "ownerUserId")
  ON DELETE NO ACTION ON UPDATE CASCADE;

-- Перенос: у тренера двух клубов было две карточки, остаётся самая свежая.
INSERT INTO "CoachCard" ("userId", "photoFileId", "achievements", "inventory", "socialLinks", "createdAt", "updatedAt")
SELECT DISTINCT ON ("userId")
  "userId", "photoFileId", "achievements", "inventory", "socialLinks", "createdAt", "updatedAt"
FROM "CoachProfile"
WHERE "photoFileId" IS NOT NULL
   OR "achievements" IS NOT NULL
   OR "inventory" IS NOT NULL
   OR "socialLinks" IS NOT NULL
ORDER BY "userId", "updatedAt" DESC;

-- AlterTable
ALTER TABLE "CoachProfile" DROP CONSTRAINT "CoachProfile_photoFileId_userId_fkey";
DROP INDEX "CoachProfile_photoFileId_key";
ALTER TABLE "CoachProfile" DROP CONSTRAINT "CoachProfile_text_filled";

ALTER TABLE "CoachProfile" DROP COLUMN "achievements",
DROP COLUMN "inventory",
DROP COLUMN "photoFileId",
DROP COLUMN "priceInfo",
DROP COLUMN "socialLinks",
ADD COLUMN     "groupPrice" INTEGER,
ADD COLUMN     "individualPrice" INTEGER,
ADD COLUMN     "priceNote" TEXT;

-- Текстовые поля карточки: пусто — это NULL, а не пустая строка.
ALTER TABLE "CoachCard"
  ADD CONSTRAINT "CoachCard_text_filled"
  CHECK (
    ("achievements" IS NULL OR ("achievements" = btrim("achievements") AND char_length("achievements") BETWEEN 1 AND 2000))
    AND ("inventory" IS NULL OR ("inventory" = btrim("inventory") AND char_length("inventory") BETWEEN 1 AND 1000))
  );

-- Цены — неотрицательные копейки, приписка — непустая строка.
ALTER TABLE "CoachProfile"
  ADD CONSTRAINT "CoachProfile_prices_sane"
  CHECK (
    ("groupPrice" IS NULL OR "groupPrice" >= 0)
    AND ("individualPrice" IS NULL OR "individualPrice" >= 0)
    AND ("priceNote" IS NULL OR ("priceNote" = btrim("priceNote") AND char_length("priceNote") BETWEEN 1 AND 300))
  );

-- Журнал абонементов становится неприкосновенным: лазейка для уборки смоука
-- снята (решение владельца от 20.09.2026). Пробные учётки с абонементами
-- уборка теперь не удаляет и честно об этом сообщает.
CREATE OR REPLACE FUNCTION "SubscriptionLedger_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SubscriptionLedger — журнал только для вставок, % запрещён', TG_OP
    USING ERRCODE = '23001';
END
$$;
