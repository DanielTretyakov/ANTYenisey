-- Решения владельца от 26.09.2026 (вечер): абонемент покрывает аренду стола
-- (бронь любой длины — один визит), типы спаррингов с ценой — ученик в брони
-- спарринга платит цену типа, выключатель «не показывать меня» в открытом
-- рейтинге посещений, лента публикаций клуба с сообщением клиентам.

-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'CLUB_NEWS';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CLUB_POST';

-- AlterTable
ALTER TABLE "TableBooking" ADD COLUMN     "sparringTypeId" TEXT,
ADD COLUMN     "subscriptionId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "ratingHidden" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SparringType" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hourPrice" INTEGER NOT NULL,
    "minAge" INTEGER,
    "maxAge" INTEGER,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SparringType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubPost" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SparringType_id_tenantId_key" ON "SparringType"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SparringType_tenantId_name_key" ON "SparringType"("tenantId", "name");

-- CreateIndex
CREATE INDEX "ClubPost_tenantId_publishedAt_idx" ON "ClubPost"("tenantId", "publishedAt");

-- AddForeignKey
ALTER TABLE "TableBooking" ADD CONSTRAINT "TableBooking_sparringTypeId_tenantId_fkey" FOREIGN KEY ("sparringTypeId", "tenantId") REFERENCES "SparringType"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableBooking" ADD CONSTRAINT "TableBooking_subscriptionId_clientId_tenantId_fkey" FOREIGN KEY ("subscriptionId", "clientId", "tenantId") REFERENCES "Subscription"("id", "clientId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SparringType" ADD CONSTRAINT "SparringType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubPost" ADD CONSTRAINT "ClubPost_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubPost" ADD CONSTRAINT "ClubPost_authorId_tenantId_fkey" FOREIGN KEY ("authorId", "tenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;



-- CHECK — те же, что в constraints.sql (разделы 1, 21 и 32).

-- Форма брони: у спарринга бывает ученик (clientId рядом с coachId) и тогда
-- тип спарринга. Прежние две проверки заменяет одна.
ALTER TABLE "TableBooking" DROP CONSTRAINT "TableBooking_client_xor_coach";
ALTER TABLE "TableBooking" DROP CONSTRAINT "TableBooking_sparring_has_coach";

ALTER TABLE "TableBooking"
  ADD CONSTRAINT "TableBooking_owner_shape"
  CHECK (
    CASE WHEN "isSparring"
      THEN "coachId" IS NOT NULL
       AND ("clientId" IS NULL) = ("sparringTypeId" IS NULL)
       AND ("clientId" IS NULL OR "clientId" <> "coachId")
      ELSE "clientId" IS NOT NULL AND "coachId" IS NULL AND "sparringTypeId" IS NULL
    END
  );

ALTER TABLE "TableBooking"
  ADD CONSTRAINT "TableBooking_subscription_ratio"
  CHECK ("subscriptionId" IS NULL OR "chargeRatio" IS NULL OR "chargeRatio" IN (0, 100));

ALTER TABLE "TableBooking"
  ADD CONSTRAINT "TableBooking_subscription_plain_rental"
  CHECK (
    "subscriptionId" IS NULL
    OR ("clientId" IS NOT NULL AND NOT "isSparring" AND NOT "withRobot")
  );

-- Журнал абонемента: движение по визиту теперь бывает и за аренду стола.
ALTER TABLE "SubscriptionLedger" DROP CONSTRAINT "SubscriptionLedger_link_matches_reason";

ALTER TABLE "SubscriptionLedger"
  ADD CONSTRAINT "SubscriptionLedger_link_matches_reason"
  CHECK (
    CASE
      WHEN "reason" IN ('VISIT_CHARGED', 'VISIT_REFUNDED')
        THEN ("trainingBookingId" IS NOT NULL)::int
           + ("tournamentRegistrationId" IS NOT NULL)::int
           + ("tableBookingId" IS NOT NULL)::int = 1
      ELSE "trainingBookingId" IS NULL
       AND "tournamentRegistrationId" IS NULL
       AND "tableBookingId" IS NULL
    END
  );

ALTER TABLE "SparringType"
  ADD CONSTRAINT "SparringType_name_filled"
  CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 100);

ALTER TABLE "SparringType"
  ADD CONSTRAINT "SparringType_price_sane"
  CHECK ("hourPrice" BETWEEN 0 AND 100000000);

ALTER TABLE "SparringType"
  ADD CONSTRAINT "SparringType_ages_sane"
  CHECK (
    ("minAge" IS NULL OR "minAge" BETWEEN 0 AND 120)
    AND ("maxAge" IS NULL OR "maxAge" BETWEEN 0 AND 120)
    AND ("minAge" IS NULL OR "maxAge" IS NULL OR "minAge" <= "maxAge")
  );

ALTER TABLE "SparringType"
  ADD CONSTRAINT "SparringType_description_sane"
  CHECK ("description" IS NULL OR (btrim("description") <> '' AND char_length("description") <= 1000));

ALTER TABLE "ClubPost"
  ADD CONSTRAINT "ClubPost_title_sane"
  CHECK (btrim("title") <> '' AND char_length("title") <= 160);

ALTER TABLE "ClubPost"
  ADD CONSTRAINT "ClubPost_body_sane"
  CHECK (btrim("body") <> '' AND char_length("body") <= 20000);
