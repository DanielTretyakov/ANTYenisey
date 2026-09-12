-- Профиль игрока: файлы, инвентарь, достижения, спортивный разряд.
-- Расширение сверх ТЗ по решению владельца продукта от 12.09.2026.

-- CreateEnum
CREATE TYPE "StoredFileKind" AS ENUM ('AVATAR', 'RANK_DOCUMENT');

-- CreateEnum
CREATE TYPE "AchievementLevel" AS ENUM ('INTERNATIONAL', 'NATIONAL', 'REGIONAL', 'CITY', 'CLUB');

-- CreateEnum
CREATE TYPE "SportRankLevel" AS ENUM ('YOUTH_3', 'YOUTH_2', 'YOUTH_1', 'SPORT_3', 'SPORT_2', 'SPORT_1', 'KMS', 'MS', 'MSMK');

-- CreateEnum
CREATE TYPE "SportRankStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'RANK_VERIFIED';
ALTER TYPE "AuditAction" ADD VALUE 'RANK_REJECTED';

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "kind" "StoredFileKind" NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerProfile" (
    "userId" TEXT NOT NULL,
    "avatarFileId" TEXT,
    "blade" TEXT,
    "forehandRubber" TEXT,
    "backhandRubber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "level" "AchievementLevel" NOT NULL,
    "place" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SportRank" (
    "userId" TEXT NOT NULL,
    "rank" "SportRankLevel" NOT NULL,
    "orderNumber" TEXT,
    "orderDate" DATE,
    "documentFileId" TEXT,
    "status" "SportRankStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedByUserId" TEXT,
    "reviewedInTenantId" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SportRank_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "StoredFile_ownerUserId_idx" ON "StoredFile"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_id_ownerUserId_key" ON "StoredFile"("id", "ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerProfile_avatarFileId_key" ON "PlayerProfile"("avatarFileId");

-- CreateIndex
CREATE INDEX "Achievement_userId_date_idx" ON "Achievement"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SportRank_documentFileId_key" ON "SportRank"("documentFileId");

-- CreateIndex
CREATE INDEX "SportRank_reviewedByUserId_reviewedInTenantId_idx" ON "SportRank"("reviewedByUserId", "reviewedInTenantId");

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerProfile" ADD CONSTRAINT "PlayerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerProfile" ADD CONSTRAINT "PlayerProfile_avatarFileId_userId_fkey" FOREIGN KEY ("avatarFileId", "userId") REFERENCES "StoredFile"("id", "ownerUserId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SportRank" ADD CONSTRAINT "SportRank_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SportRank" ADD CONSTRAINT "SportRank_documentFileId_userId_fkey" FOREIGN KEY ("documentFileId", "userId") REFERENCES "StoredFile"("id", "ownerUserId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SportRank" ADD CONSTRAINT "SportRank_reviewedByUserId_reviewedInTenantId_fkey" FOREIGN KEY ("reviewedByUserId", "reviewedInTenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Ограничения целостности — раздел 18 constraints.sql
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
--
-- Накатано миграцией *_players. Расширение сверх ТЗ по решению владельца
-- продукта от 12.09.2026. Денег здесь нет, зато есть чужие персональные
-- данные (скан приказа — с паспортными данными и датой рождения) и подпись
-- клуба, которой верят другие клубы.

-- Размер в строке — размер байтов, а не цифра, которую прислал клиент.
ALTER TABLE "StoredFile"
  ADD CONSTRAINT "StoredFile_size_matches_data"
  CHECK ("size" = octet_length("data"));

-- Лимит своего вида. Аватар хранится уже пережатым (512×512 WebP, обычно
-- десятки килобайт), и мегабайт — потолок с запасом: больше означает, что
-- пережатие не сработало. Приказ — до 10 МБ: PDF хранится как есть.
ALTER TABLE "StoredFile"
  ADD CONSTRAINT "StoredFile_size_within_limit"
  CHECK (
    "size" > 0 AND
    CASE "kind"
      WHEN 'AVATAR' THEN "size" <= 1048576
      WHEN 'RANK_DOCUMENT' THEN "size" <= 10485760
    END
  );

-- Формат своего вида. SVG нет нигде: это исполняемый код, притворяющийся
-- картинкой. Аватар — только WebP: сервер перекодирует любую картинку в него.
ALTER TABLE "StoredFile"
  ADD CONSTRAINT "StoredFile_type_matches_kind"
  CHECK (
    CASE "kind"
      WHEN 'AVATAR' THEN "contentType" = 'image/webp'
      WHEN 'RANK_DOCUMENT' THEN "contentType" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
    END
  );

ALTER TABLE "StoredFile"
  ADD CONSTRAINT "StoredFile_sha256_format"
  CHECK ("sha256" ~ '^[0-9a-f]{64}$');

-- Инвентарь: пусто — это NULL, а не пустая строка или пробелы. Иначе у
-- «ничего не указано» два написания, и публичная страница рисует пустую
-- строку под заголовком «Основание».
ALTER TABLE "PlayerProfile"
  ADD CONSTRAINT "PlayerProfile_equipment_filled"
  CHECK (
    ("blade" IS NULL OR ("blade" = btrim("blade") AND char_length("blade") BETWEEN 1 AND 100))
    AND ("forehandRubber" IS NULL OR ("forehandRubber" = btrim("forehandRubber") AND char_length("forehandRubber") BETWEEN 1 AND 100))
    AND ("backhandRubber" IS NULL OR ("backhandRubber" = btrim("backhandRubber") AND char_length("backhandRubber") BETWEEN 1 AND 100))
  );

ALTER TABLE "Achievement"
  ADD CONSTRAINT "Achievement_title_filled"
  CHECK ("title" = btrim("title") AND char_length("title") BETWEEN 1 AND 200);

ALTER TABLE "Achievement"
  ADD CONSTRAINT "Achievement_note_filled"
  CHECK ("note" IS NULL OR ("note" = btrim("note") AND char_length("note") BETWEEN 1 AND 500));

-- Место — с первого. Ноль и минус не значат ничего, а «участие» — это NULL.
ALTER TABLE "Achievement"
  ADD CONSTRAINT "Achievement_place_positive"
  CHECK ("place" IS NULL OR "place" >= 1);

-- Та же нижняя граница, что у даты рождения: раньше — опечатка в годе.
ALTER TABLE "Achievement"
  ADD CONSTRAINT "Achievement_date_sane"
  CHECK ("date" >= DATE '1900-01-01');

-- Номер и дата приказа — только вместе: приказ без даты не находится в
-- реестре, дата без номера не говорит ничего.
ALTER TABLE "SportRank"
  ADD CONSTRAINT "SportRank_order_complete"
  CHECK (("orderNumber" IS NULL) = ("orderDate" IS NULL));

ALTER TABLE "SportRank"
  ADD CONSTRAINT "SportRank_order_number_filled"
  CHECK ("orderNumber" IS NULL OR ("orderNumber" = btrim("orderNumber") AND char_length("orderNumber") BETWEEN 1 AND 50));

-- Разряд обоснован: приказ реквизитами либо сканом. Подтверждать «КМС, верьте
-- на слово» администратору нечем.
ALTER TABLE "SportRank"
  ADD CONSTRAINT "SportRank_justified"
  CHECK ("documentFileId" IS NOT NULL OR "orderNumber" IS NOT NULL);

-- Решение несёт того, кто его принял, где и когда; отказ — ещё и причину.
-- Разряд на проверке не несёт ничего: правка игроком стирает прежнее
-- решение целиком, иначе подпись «подтвердил клуб X» осталась бы висеть над
-- разрядом, которого клуб X не видел.
--
-- Оба поля проверяющего — вместе: составной внешний ключ с одной пустой
-- половиной Postgres не проверяет вовсе (MATCH SIMPLE).
ALTER TABLE "SportRank"
  ADD CONSTRAINT "SportRank_review_matches_status"
  CHECK (
    CASE "status"
      WHEN 'PENDING' THEN "reviewedByUserId" IS NULL AND "reviewedInTenantId" IS NULL
                      AND "reviewedAt" IS NULL AND "rejectionReason" IS NULL
      WHEN 'VERIFIED' THEN "reviewedByUserId" IS NOT NULL AND "reviewedInTenantId" IS NOT NULL
                       AND "reviewedAt" IS NOT NULL AND "rejectionReason" IS NULL
      WHEN 'REJECTED' THEN "reviewedByUserId" IS NOT NULL AND "reviewedInTenantId" IS NOT NULL
                       AND "reviewedAt" IS NOT NULL AND "rejectionReason" IS NOT NULL
    END
  );

ALTER TABLE "SportRank"
  ADD CONSTRAINT "SportRank_rejection_reason_filled"
  CHECK ("rejectionReason" IS NULL OR ("rejectionReason" = btrim("rejectionReason") AND char_length("rejectionReason") BETWEEN 1 AND 500));

-- Свой разряд не подтверждает никто. Администратор клуба, который играет в
-- этом же клубе, — обычное дело, и без запрета подпись «подтвердил клуб X»
-- значила бы «подтвердил сам себе» (решение владельца от 12.09.2026).
ALTER TABLE "SportRank"
  ADD CONSTRAINT "SportRank_not_self_review"
  CHECK ("reviewedByUserId" IS NULL OR "reviewedByUserId" <> "userId");

-- Чего здесь НЕТ и почему.
--
-- Вид файла по ссылке (аватар ссылается на AVATAR, приказ — на
-- RANK_DOCUMENT) не проверяется: это сравнение со строкой другой таблицы.
-- Владельца база проверяет — составной ключ (файл, человек), — и перепутанный
-- вид означал бы только битую картинку, а не чужие данные. Вид выбирает
-- сервис, и выбирает по маршруту, а не по запросу.
--
-- Что проверяющий в своём клубе администратор, а игрок там состоит, — тоже
-- сравнение строк других таблиц. Это держит сервис, а база держит главное:
-- проверяющий — человек именно того клуба, что в подписи.
--
-- «Достижение не из будущего» в CHECK не выражается: now() не IMMUTABLE
-- (та же причина, что в разделе 17). Проверка — в сервисе.
