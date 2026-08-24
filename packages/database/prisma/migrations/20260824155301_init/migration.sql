-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CLIENT', 'ADMIN', 'COACH', 'OWNER');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('ONLINE', 'MANUAL');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('BOOKED', 'CANCELLED', 'ATTENDED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "BookingStep" AS ENUM ('MIN_10', 'MIN_15', 'MIN_20', 'MIN_30', 'HOUR_1');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('YOOKASSA', 'SUBSCRIPTION_BALANCE', 'CASH');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('HELD', 'CAPTURED', 'PARTIALLY_CAPTURED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('SERVICE', 'SUBSCRIPTION_PURCHASE');

-- CreateEnum
CREATE TYPE "PlatformSubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'SUSPENDED', 'EXEMPT');

-- CreateEnum
CREATE TYPE "LedgerReason" AS ENUM ('PURCHASE', 'VISIT_CHARGED', 'VISIT_REFUNDED', 'VISIT_BURNED', 'ADMIN_ADJUSTMENT', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VisitSourceType" AS ENUM ('TRAINING', 'TOURNAMENT', 'TABLE', 'WALK_IN');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('TELEGRAM', 'WEB_PUSH');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'BOOKING_REMINDER', 'ATTENDANCE_ESCALATION_HOUR', 'ATTENDANCE_AUTO_NO_SHOW', 'SUBSCRIPTION_PAST_DUE');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM_JOB', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('BOOKING_CREATED', 'BOOKING_CANCELLED', 'ATTENDANCE_MARKED', 'NO_SHOW_MARKED', 'AUTO_NO_SHOW_APPLIED', 'PAYMENT_HELD', 'PAYMENT_CAPTURED', 'PAYMENT_REFUNDED', 'SUBSCRIPTION_BALANCE_ADJUSTED', 'PRICE_CHANGED', 'CANCELLATION_POLICY_CHANGED', 'ROLE_CHANGED', 'CLIENT_ANONYMIZED');

-- CreateEnum
CREATE TYPE "LegalDocumentType" AS ENUM ('PUBLIC_OFFER', 'PERSONAL_DATA_CONSENT', 'RECURRENT_PAYMENT_CONSENT', 'PRIVACY_POLICY');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Krasnoyarsk',
    "hasRobotOption" BOOLEAN NOT NULL DEFAULT false,
    "bookingStep" "BookingStep" NOT NULL DEFAULT 'MIN_30',
    "tableHourPrice" INTEGER NOT NULL,
    "tableExtra30MinPrice" INTEGER NOT NULL,
    "robot30MinPrice" INTEGER,
    "robot60MinPrice" INTEGER,
    "robotExtra30MinPrice" INTEGER,
    "noShowChargePercent" INTEGER NOT NULL DEFAULT 100,
    "subscriptionBurnsOnNoShowOnly" BOOLEAN NOT NULL DEFAULT true,
    "attendanceReminderAfterMinutes" INTEGER NOT NULL DEFAULT 60,
    "attendanceAutoNoShowAfterMinutes" INTEGER NOT NULL DEFAULT 1440,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CancellationTier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "minMinutesBeforeStart" INTEGER NOT NULL,
    "chargePercent" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CancellationTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "periodMonths" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSubscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT,
    "priceAtPurchase" INTEGER,
    "status" "PlatformSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextChargeDate" TIMESTAMP(3),
    "savedPaymentMethodId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deactivatedAt" TIMESTAMP(3),
    "anonymizedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientProfile" (
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3),
    "rating" INTEGER,
    "savedPaymentMethodId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "CoachProfile" (
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "photoUrl" TEXT,
    "achievements" TEXT,
    "inventory" TEXT,
    "priceInfo" TEXT,
    "socialLinks" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "TrainingType" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "trainingTypeId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingBooking" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'BOOKED',
    "source" "BookingSource" NOT NULL DEFAULT 'ONLINE',
    "priceAtBooking" INTEGER NOT NULL,
    "cancelledAt" TIMESTAMPTZ(3),
    "chargeRatio" INTEGER,
    "paymentId" TEXT,
    "reminderSentAt" TIMESTAMPTZ(3),
    "autoNoShowAppliedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentType" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ratingLabel" TEXT,
    "price" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tournamentTypeId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentRegistration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'BOOKED',
    "priceAtBooking" INTEGER NOT NULL,
    "cancelledAt" TIMESTAMPTZ(3),
    "chargeRatio" INTEGER,
    "paymentId" TEXT,
    "reminderSentAt" TIMESTAMPTZ(3),
    "autoNoShowAppliedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Table" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableBooking" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "clientId" TEXT,
    "coachId" TEXT,
    "isSparring" BOOLEAN NOT NULL DEFAULT false,
    "withRobot" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "priceAtBooking" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'BOOKED',
    "cancelledAt" TIMESTAMPTZ(3),
    "chargeRatio" INTEGER,
    "paymentId" TEXT,
    "reminderSentAt" TIMESTAMPTZ(3),
    "autoNoShowAppliedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TableBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visitsCount" INTEGER,
    "durationDays" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "coversTableRental" BOOLEAN NOT NULL DEFAULT false,
    "tableRentalUnlimitedOnly" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlanTrainingType" (
    "planId" TEXT NOT NULL,
    "trainingTypeId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "SubscriptionPlanTrainingType_pkey" PRIMARY KEY ("planId","trainingTypeId")
);

-- CreateTable
CREATE TABLE "SubscriptionPlanTournamentType" (
    "planId" TEXT NOT NULL,
    "tournamentTypeId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "SubscriptionPlanTournamentType_pkey" PRIMARY KEY ("planId","tournamentTypeId")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "remainingVisits" INTEGER,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3),
    "paymentId" TEXT,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionLedger" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER,
    "reason" "LedgerReason" NOT NULL,
    "trainingBookingId" TEXT,
    "tournamentRegistrationId" TEXT,
    "tableBookingId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT,
    "purpose" "PaymentPurpose" NOT NULL DEFAULT 'SERVICE',
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "holdAmount" INTEGER,
    "capturedAmount" INTEGER,
    "externalId" TEXT,
    "savedPaymentMethodId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'yookassa',
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "coachId" TEXT,
    "sourceType" "VisitSourceType" NOT NULL,
    "trainingBookingId" TEXT,
    "tournamentRegistrationId" TEXT,
    "tableBookingId" TEXT,
    "paymentId" TEXT,
    "attended" BOOLEAN NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "actorType" "ActorType" NOT NULL DEFAULT 'USER',
    "actorUserId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "type" "LegalDocumentType" NOT NULL,
    "version" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalAcceptance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "LegalAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "type" "NotificationType" NOT NULL,
    "payload" JSONB,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CancellationTier_tenantId_minMinutesBeforeStart_key" ON "CancellationTier"("tenantId", "minMinutesBeforeStart");

-- CreateIndex
CREATE INDEX "PlatformPlan_isActive_idx" ON "PlatformPlan"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TenantSubscription_tenantId_key" ON "TenantSubscription"("tenantId");

-- CreateIndex
CREATE INDEX "TenantSubscription_status_nextChargeDate_idx" ON "TenantSubscription"("status", "nextChargeDate");

-- CreateIndex
CREATE INDEX "User_tenantId_role_idx" ON "User"("tenantId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "User_id_tenantId_key" ON "User"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientProfile_userId_tenantId_key" ON "ClientProfile"("userId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CoachProfile_userId_tenantId_key" ON "CoachProfile"("userId", "tenantId");

-- CreateIndex
CREATE INDEX "TrainingType_tenantId_idx" ON "TrainingType"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingType_id_tenantId_key" ON "TrainingType"("id", "tenantId");

-- CreateIndex
CREATE INDEX "TrainingSession_tenantId_startsAt_idx" ON "TrainingSession"("tenantId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingSession_id_tenantId_key" ON "TrainingSession"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingBooking_paymentId_key" ON "TrainingBooking"("paymentId");

-- CreateIndex
CREATE INDEX "TrainingBooking_sessionId_idx" ON "TrainingBooking"("sessionId");

-- CreateIndex
CREATE INDEX "TrainingBooking_clientId_idx" ON "TrainingBooking"("clientId");

-- CreateIndex
CREATE INDEX "TrainingBooking_tenantId_status_idx" ON "TrainingBooking"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingBooking_id_tenantId_key" ON "TrainingBooking"("id", "tenantId");

-- CreateIndex
CREATE INDEX "TournamentType_tenantId_idx" ON "TournamentType"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentType_id_tenantId_key" ON "TournamentType"("id", "tenantId");

-- CreateIndex
CREATE INDEX "Tournament_tenantId_startsAt_idx" ON "Tournament"("tenantId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_id_tenantId_key" ON "Tournament"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentRegistration_paymentId_key" ON "TournamentRegistration"("paymentId");

-- CreateIndex
CREATE INDEX "TournamentRegistration_tournamentId_idx" ON "TournamentRegistration"("tournamentId");

-- CreateIndex
CREATE INDEX "TournamentRegistration_clientId_idx" ON "TournamentRegistration"("clientId");

-- CreateIndex
CREATE INDEX "TournamentRegistration_tenantId_status_idx" ON "TournamentRegistration"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentRegistration_id_tenantId_key" ON "TournamentRegistration"("id", "tenantId");

-- CreateIndex
CREATE INDEX "Table_tenantId_idx" ON "Table"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Table_id_tenantId_key" ON "Table"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Table_tenantId_label_key" ON "Table"("tenantId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "TableBooking_paymentId_key" ON "TableBooking"("paymentId");

-- CreateIndex
CREATE INDEX "TableBooking_tenantId_startsAt_idx" ON "TableBooking"("tenantId", "startsAt");

-- CreateIndex
CREATE INDEX "TableBooking_tableId_startsAt_idx" ON "TableBooking"("tableId", "startsAt");

-- CreateIndex
CREATE INDEX "TableBooking_tenantId_status_endsAt_idx" ON "TableBooking"("tenantId", "status", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "TableBooking_id_tenantId_key" ON "TableBooking"("id", "tenantId");

-- CreateIndex
CREATE INDEX "SubscriptionPlan_tenantId_idx" ON "SubscriptionPlan"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_id_tenantId_key" ON "SubscriptionPlan"("id", "tenantId");

-- CreateIndex
CREATE INDEX "SubscriptionPlanTrainingType_tenantId_idx" ON "SubscriptionPlanTrainingType"("tenantId");

-- CreateIndex
CREATE INDEX "SubscriptionPlanTournamentType_tenantId_idx" ON "SubscriptionPlanTournamentType"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_paymentId_key" ON "Subscription"("paymentId");

-- CreateIndex
CREATE INDEX "Subscription_tenantId_clientId_idx" ON "Subscription"("tenantId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_id_tenantId_key" ON "Subscription"("id", "tenantId");

-- CreateIndex
CREATE INDEX "SubscriptionLedger_tenantId_subscriptionId_idx" ON "SubscriptionLedger"("tenantId", "subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_externalId_key" ON "Payment"("externalId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_idx" ON "Payment"("tenantId");

-- CreateIndex
CREATE INDEX "WebhookEvent_processedAt_idx" ON "WebhookEvent"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VisitLog_paymentId_key" ON "VisitLog"("paymentId");

-- CreateIndex
CREATE INDEX "VisitLog_tenantId_clientId_idx" ON "VisitLog"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "VisitLog_tenantId_coachId_idx" ON "VisitLog"("tenantId", "coachId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_tenantId_userId_idx" ON "RefreshToken"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_entityType_entityId_idx" ON "AuditLog"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_actorUserId_idx" ON "AuditLog"("tenantId", "actorUserId");

-- CreateIndex
CREATE INDEX "LegalDocument_tenantId_type_idx" ON "LegalDocument"("tenantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "LegalDocument_tenantId_type_version_key" ON "LegalDocument"("tenantId", "type", "version");

-- CreateIndex
CREATE INDEX "LegalAcceptance_tenantId_userId_idx" ON "LegalAcceptance"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalAcceptance_userId_documentId_key" ON "LegalAcceptance"("userId", "documentId");

-- CreateIndex
CREATE INDEX "Notification_tenantId_userId_idx" ON "Notification"("tenantId", "userId");

-- AddForeignKey
ALTER TABLE "CancellationTier" ADD CONSTRAINT "CancellationTier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSubscription" ADD CONSTRAINT "TenantSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSubscription" ADD CONSTRAINT "TenantSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PlatformPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProfile" ADD CONSTRAINT "ClientProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProfile" ADD CONSTRAINT "ClientProfile_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachProfile" ADD CONSTRAINT "CoachProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachProfile" ADD CONSTRAINT "CoachProfile_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingType" ADD CONSTRAINT "TrainingType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_trainingTypeId_tenantId_fkey" FOREIGN KEY ("trainingTypeId", "tenantId") REFERENCES "TrainingType"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_coachId_tenantId_fkey" FOREIGN KEY ("coachId", "tenantId") REFERENCES "CoachProfile"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingBooking" ADD CONSTRAINT "TrainingBooking_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingBooking" ADD CONSTRAINT "TrainingBooking_sessionId_tenantId_fkey" FOREIGN KEY ("sessionId", "tenantId") REFERENCES "TrainingSession"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingBooking" ADD CONSTRAINT "TrainingBooking_clientId_tenantId_fkey" FOREIGN KEY ("clientId", "tenantId") REFERENCES "ClientProfile"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingBooking" ADD CONSTRAINT "TrainingBooking_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentType" ADD CONSTRAINT "TournamentType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_tournamentTypeId_tenantId_fkey" FOREIGN KEY ("tournamentTypeId", "tenantId") REFERENCES "TournamentType"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentRegistration" ADD CONSTRAINT "TournamentRegistration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentRegistration" ADD CONSTRAINT "TournamentRegistration_tournamentId_tenantId_fkey" FOREIGN KEY ("tournamentId", "tenantId") REFERENCES "Tournament"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentRegistration" ADD CONSTRAINT "TournamentRegistration_clientId_tenantId_fkey" FOREIGN KEY ("clientId", "tenantId") REFERENCES "ClientProfile"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentRegistration" ADD CONSTRAINT "TournamentRegistration_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableBooking" ADD CONSTRAINT "TableBooking_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableBooking" ADD CONSTRAINT "TableBooking_tableId_tenantId_fkey" FOREIGN KEY ("tableId", "tenantId") REFERENCES "Table"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableBooking" ADD CONSTRAINT "TableBooking_clientId_tenantId_fkey" FOREIGN KEY ("clientId", "tenantId") REFERENCES "ClientProfile"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableBooking" ADD CONSTRAINT "TableBooking_coachId_tenantId_fkey" FOREIGN KEY ("coachId", "tenantId") REFERENCES "CoachProfile"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableBooking" ADD CONSTRAINT "TableBooking_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPlan" ADD CONSTRAINT "SubscriptionPlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPlanTrainingType" ADD CONSTRAINT "SubscriptionPlanTrainingType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPlanTrainingType" ADD CONSTRAINT "SubscriptionPlanTrainingType_planId_tenantId_fkey" FOREIGN KEY ("planId", "tenantId") REFERENCES "SubscriptionPlan"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPlanTrainingType" ADD CONSTRAINT "SubscriptionPlanTrainingType_trainingTypeId_tenantId_fkey" FOREIGN KEY ("trainingTypeId", "tenantId") REFERENCES "TrainingType"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPlanTournamentType" ADD CONSTRAINT "SubscriptionPlanTournamentType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPlanTournamentType" ADD CONSTRAINT "SubscriptionPlanTournamentType_planId_tenantId_fkey" FOREIGN KEY ("planId", "tenantId") REFERENCES "SubscriptionPlan"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPlanTournamentType" ADD CONSTRAINT "SubscriptionPlanTournamentType_tournamentTypeId_tenantId_fkey" FOREIGN KEY ("tournamentTypeId", "tenantId") REFERENCES "TournamentType"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_clientId_tenantId_fkey" FOREIGN KEY ("clientId", "tenantId") REFERENCES "ClientProfile"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_tenantId_fkey" FOREIGN KEY ("planId", "tenantId") REFERENCES "SubscriptionPlan"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionLedger" ADD CONSTRAINT "SubscriptionLedger_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionLedger" ADD CONSTRAINT "SubscriptionLedger_subscriptionId_tenantId_fkey" FOREIGN KEY ("subscriptionId", "tenantId") REFERENCES "Subscription"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionLedger" ADD CONSTRAINT "SubscriptionLedger_trainingBookingId_tenantId_fkey" FOREIGN KEY ("trainingBookingId", "tenantId") REFERENCES "TrainingBooking"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionLedger" ADD CONSTRAINT "SubscriptionLedger_tournamentRegistrationId_tenantId_fkey" FOREIGN KEY ("tournamentRegistrationId", "tenantId") REFERENCES "TournamentRegistration"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionLedger" ADD CONSTRAINT "SubscriptionLedger_tableBookingId_tenantId_fkey" FOREIGN KEY ("tableBookingId", "tenantId") REFERENCES "TableBooking"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_clientId_tenantId_fkey" FOREIGN KEY ("clientId", "tenantId") REFERENCES "ClientProfile"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitLog" ADD CONSTRAINT "VisitLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitLog" ADD CONSTRAINT "VisitLog_clientId_tenantId_fkey" FOREIGN KEY ("clientId", "tenantId") REFERENCES "ClientProfile"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitLog" ADD CONSTRAINT "VisitLog_coachId_tenantId_fkey" FOREIGN KEY ("coachId", "tenantId") REFERENCES "CoachProfile"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitLog" ADD CONSTRAINT "VisitLog_trainingBookingId_tenantId_fkey" FOREIGN KEY ("trainingBookingId", "tenantId") REFERENCES "TrainingBooking"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitLog" ADD CONSTRAINT "VisitLog_tournamentRegistrationId_tenantId_fkey" FOREIGN KEY ("tournamentRegistrationId", "tenantId") REFERENCES "TournamentRegistration"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitLog" ADD CONSTRAINT "VisitLog_tableBookingId_tenantId_fkey" FOREIGN KEY ("tableBookingId", "tenantId") REFERENCES "TableBooking"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitLog" ADD CONSTRAINT "VisitLog_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitLog" ADD CONSTRAINT "VisitLog_recordedByUserId_tenantId_fkey" FOREIGN KEY ("recordedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_tenantId_fkey" FOREIGN KEY ("actorUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "LegalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
