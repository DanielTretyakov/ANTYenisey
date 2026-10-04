-- Подписка клуба на КНТ: оплата картой и по счёту, акты раз в месяц,
-- пробный период (решения владельца от 02.10.2026, ТЗ → «Монетизация
-- платформы»). Здесь — только структура: новое значение enum нельзя
-- использовать в той же транзакции, где оно добавлено, поэтому данные и
-- ограничения — следующей миграцией (*_platform_billing_data).

-- CreateEnum
CREATE TYPE "PlatformPaymentMethod" AS ENUM ('CARD', 'INVOICE');

-- CreateEnum
CREATE TYPE "PlatformPaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_SUSPENDED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_PAID';

-- AlterEnum
ALTER TYPE "PlatformSubscriptionStatus" ADD VALUE 'TRIAL';

-- AlterTable
ALTER TABLE "TenantSubscription" ADD COLUMN     "autoRenew" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "chargeAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastChargeAttemptAt" TIMESTAMP(3),
ADD COLUMN     "paidUntil" TIMESTAMP(3),
ADD COLUMN     "pastDueSince" TIMESTAMP(3),
ADD COLUMN     "paymentMethodTitle" TEXT,
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PlatformPayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "PlatformPaymentMethod" NOT NULL,
    "status" "PlatformPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "autoCharge" BOOLEAN NOT NULL DEFAULT false,
    "providerPaymentId" TEXT,
    "invoiceNumber" INTEGER,
    "failureReason" TEXT,
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAct" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubRequisites" (
    "tenantId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "inn" TEXT NOT NULL,
    "kpp" TEXT,
    "address" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubRequisites_pkey" PRIMARY KEY ("tenantId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPayment_providerPaymentId_key" ON "PlatformPayment"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPayment_invoiceNumber_key" ON "PlatformPayment"("invoiceNumber");

-- CreateIndex
CREATE INDEX "PlatformPayment_tenantId_createdAt_idx" ON "PlatformPayment"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAct_number_key" ON "PlatformAct"("number");

-- CreateIndex
CREATE INDEX "PlatformAct_tenantId_periodFrom_idx" ON "PlatformAct"("tenantId", "periodFrom");

-- AddForeignKey
ALTER TABLE "PlatformPayment" ADD CONSTRAINT "PlatformPayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformPayment" ADD CONSTRAINT "PlatformPayment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PlatformPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAct" ADD CONSTRAINT "PlatformAct_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAct" ADD CONSTRAINT "PlatformAct_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PlatformPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubRequisites" ADD CONSTRAINT "ClubRequisites_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
