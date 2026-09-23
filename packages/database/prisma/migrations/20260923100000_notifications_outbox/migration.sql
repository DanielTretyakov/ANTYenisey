-- Уведомления: очередь исходящих сообщений, привязка MAX, настройки и роль
-- владельца платформы (решения владельца и заказчика от 23.09.2026).
--
-- Таблица Notification существовала с первой миграции, но ни одна строка в
-- неё не писалась — перестраивается без переноса данных. Если строки всё же
-- найдутся, миграция упадёт на NOT NULL у dedupeKey: громкий отказ здесь
-- лучше тихого удаления.

CREATE TYPE "PlatformRole" AS ENUM ('OWNER');

CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TYPE "NotificationCategory" AS ENUM ('SERVICE', 'MY_BOOKINGS', 'MY_SUBSCRIPTION', 'COACH_GROUPS', 'CLUB_ALERTS', 'CLUB_DIGEST', 'PLATFORM_DIGEST');

-- Мессенджер — MAX, а не Telegram (решение заказчика). Строк нет, поэтому
-- тип пересоздаётся без перевода значений.
BEGIN;
CREATE TYPE "NotificationChannel_new" AS ENUM ('MAX', 'WEB_PUSH');
ALTER TABLE "Notification" ALTER COLUMN "channel" TYPE "NotificationChannel_new" USING ("channel"::text::"NotificationChannel_new");
ALTER TYPE "NotificationChannel" RENAME TO "NotificationChannel_old";
ALTER TYPE "NotificationChannel_new" RENAME TO "NotificationChannel";
DROP TYPE "public"."NotificationChannel_old";
COMMIT;

ALTER TYPE "NotificationType" ADD VALUE 'TEST';

-- Адресат — человек, а не членство в клубе. Составной ключ на
-- TenantMembership не пускал сводку владельцу платформы (клуба у неё нет) и
-- сообщение родителю о записи ребёнка в клуб, где родитель не состоит.
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_tenantId_fkey";

DROP INDEX "Notification_tenantId_userId_idx";

ALTER TABLE "Notification" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dedupeKey" TEXT NOT NULL,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "sendAfter" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
ALTER COLUMN "tenantId" DROP NOT NULL,
ALTER COLUMN "sentAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "readAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

ALTER TABLE "User" ADD COLUMN     "platformRole" "PlatformRole";

CREATE TABLE "MaxLink" (
    "userId" TEXT NOT NULL,
    "maxUserId" BIGINT NOT NULL,
    "linkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedAt" TIMESTAMPTZ(3),

    CONSTRAINT "MaxLink_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "MaxLinkToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaxLinkToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationSetting" (
    "userId" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("userId","category")
);

CREATE UNIQUE INDEX "MaxLink_maxUserId_key" ON "MaxLink"("maxUserId");

CREATE UNIQUE INDEX "MaxLinkToken_tokenHash_key" ON "MaxLinkToken"("tokenHash");

CREATE INDEX "MaxLinkToken_userId_idx" ON "MaxLinkToken"("userId");

CREATE INDEX "Notification_status_sendAfter_idx" ON "Notification"("status", "sendAfter");

CREATE INDEX "Notification_tenantId_idx" ON "Notification"("tenantId");

CREATE UNIQUE INDEX "Notification_userId_channel_dedupeKey_key" ON "Notification"("userId", "channel", "dedupeKey");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaxLink" ADD CONSTRAINT "MaxLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaxLinkToken" ADD CONSTRAINT "MaxLinkToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationSetting" ADD CONSTRAINT "NotificationSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ограничения — те же, что в разделе 22 constraints.sql.
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_attempts_nonneg"
  CHECK ("attempts" >= 0);

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_sent_has_time"
  CHECK (("status" = 'SENT') = ("sentAt" IS NOT NULL));

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_text_sane"
  CHECK (
    char_length("dedupeKey") BETWEEN 1 AND 200
    AND ("lastError" IS NULL OR char_length("lastError") <= 1000)
  );

ALTER TABLE "MaxLinkToken"
  ADD CONSTRAINT "MaxLinkToken_times_sane"
  CHECK ("expiresAt" > "createdAt" AND ("usedAt" IS NULL OR "usedAt" <= "expiresAt"));
