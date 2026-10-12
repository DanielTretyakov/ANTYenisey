-- Почта сервиса (решения владельца от 12.10.2026): очередь писем, одноразовые
-- ссылки, адреса «не писать», подтверждение почты и согласие на рассылку.

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "EmailTokenPurpose" AS ENUM ('VERIFY', 'RESET');

-- CreateEnum
CREATE TYPE "EmailSuppressionScope" AS ENUM ('ALL', 'NEWS');

-- CreateEnum
CREATE TYPE "EmailSuppressionReason" AS ENUM ('UNSUBSCRIBE', 'BOUNCE', 'COMPLAINT');

-- AlterTable
ALTER TABLE "ClubApplication" ADD COLUMN     "newsConsentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PlatformNews" ADD COLUMN     "emailedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "newsEmailConsentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "userId" TEXT,
    "template" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "dedupeKey" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sendAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "EmailTokenPurpose" NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSuppression" (
    "email" TEXT NOT NULL,
    "scope" "EmailSuppressionScope" NOT NULL,
    "reason" "EmailSuppressionReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("email","scope")
);

-- CreateIndex
CREATE INDEX "EmailMessage_status_sendAfter_idx" ON "EmailMessage"("status", "sendAfter");

-- CreateIndex
CREATE INDEX "EmailMessage_userId_idx" ON "EmailMessage"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_to_dedupeKey_key" ON "EmailMessage"("to", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "EmailToken_tokenHash_key" ON "EmailToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailToken_userId_purpose_idx" ON "EmailToken"("userId", "purpose");

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailToken" ADD CONSTRAINT "EmailToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Почта (решения владельца от 12.10.2026)
-- ---------------------------------------------------------------------------

-- Адрес — строчными и без пробелов по краям: отписка и «не доставляется»
-- ищутся по адресу, и «Ivan@Mail.ru» с «ivan@mail.ru» были бы двумя людьми.
ALTER TABLE "EmailMessage"
  ADD CONSTRAINT "EmailMessage_to_shape"
  CHECK ("to" = lower(btrim("to")) AND "to" LIKE '_%@_%' AND char_length("to") <= 254);

ALTER TABLE "EmailSuppression"
  ADD CONSTRAINT "EmailSuppression_email_shape"
  CHECK ("email" = lower(btrim("email")) AND "email" LIKE '_%@_%' AND char_length("email") <= 254);

-- Отправленное письмо знает, когда ушло, а неотправленное — нет.
ALTER TABLE "EmailMessage"
  ADD CONSTRAINT "EmailMessage_sent_shape"
  CHECK (("status" = 'SENT') = ("sentAt" IS NOT NULL) AND "attempts" >= 0);

-- Ссылка из письма живёт после выдачи, а не до неё.
ALTER TABLE "EmailToken"
  ADD CONSTRAINT "EmailToken_expiry"
  CHECK ("expiresAt" > "createdAt" AND "email" = lower(btrim("email")));
