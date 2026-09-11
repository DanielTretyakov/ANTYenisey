-- AlterTable
ALTER TABLE "TableBooking" ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "source" "BookingSource" NOT NULL DEFAULT 'ONLINE';

-- AlterTable
ALTER TABLE "TournamentRegistration" ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "source" "BookingSource" NOT NULL DEFAULT 'ONLINE';

-- AlterTable
ALTER TABLE "TrainingBooking" ADD COLUMN     "createdByUserId" TEXT;

-- CreateIndex
CREATE INDEX "TableBooking_tenantId_clientId_startsAt_idx" ON "TableBooking"("tenantId", "clientId", "startsAt");

-- AddForeignKey
ALTER TABLE "TrainingBooking" ADD CONSTRAINT "TrainingBooking_createdByUserId_tenantId_fkey" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentRegistration" ADD CONSTRAINT "TournamentRegistration_createdByUserId_tenantId_fkey" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableBooking" ADD CONSTRAINT "TableBooking_createdByUserId_tenantId_fkey" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Ограничения целостности (Prisma их не выражает) — раздел 16 constraints.sql
-- ---------------------------------------------------------------------------

-- Запись, заведённая администратором, обязана помнить, кто её завёл: за ней
-- стоят чужие деньги, и «кто меня записал» — первый вопрос при споре.
ALTER TABLE "TableBooking"
  ADD CONSTRAINT "TableBooking_manual_has_author"
  CHECK ("source" <> 'MANUAL'::"BookingSource" OR "createdByUserId" IS NOT NULL);

ALTER TABLE "TrainingBooking"
  ADD CONSTRAINT "TrainingBooking_manual_has_author"
  CHECK ("source" <> 'MANUAL'::"BookingSource" OR "createdByUserId" IS NOT NULL);

ALTER TABLE "TournamentRegistration"
  ADD CONSTRAINT "TournamentRegistration_manual_has_author"
  CHECK ("source" <> 'MANUAL'::"BookingSource" OR "createdByUserId" IS NOT NULL);

-- Отменённая запись обязана нести момент отмены: от него считается процент
-- списания, и без него спор о деньгах неразрешим.
ALTER TABLE "TableBooking"
  ADD CONSTRAINT "TableBooking_cancelled_has_time"
  CHECK ("status" <> 'CANCELLED'::"BookingStatus" OR "cancelledAt" IS NOT NULL);

ALTER TABLE "TrainingBooking"
  ADD CONSTRAINT "TrainingBooking_cancelled_has_time"
  CHECK ("status" <> 'CANCELLED'::"BookingStatus" OR "cancelledAt" IS NOT NULL);

ALTER TABLE "TournamentRegistration"
  ADD CONSTRAINT "TournamentRegistration_cancelled_has_time"
  CHECK ("status" <> 'CANCELLED'::"BookingStatus" OR "cancelledAt" IS NOT NULL);
