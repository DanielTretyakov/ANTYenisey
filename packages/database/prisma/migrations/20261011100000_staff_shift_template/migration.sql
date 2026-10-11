-- Шаблон смен недели (решение владельца от 10.10.2026): день без ручного
-- назначения берёт смену из шаблона зала, назначенный руками — свой список.
-- Уже назначенные дни становятся «назначенными вручную»: ни одна смена не
-- меняется оттого, что у зала появился шаблон.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'STAFF_SHIFT_MISSING';

-- CreateTable
CREATE TABLE "StaffShiftTemplate" (
    "tenantId" TEXT NOT NULL,
    "hallId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffShiftTemplate_pkey" PRIMARY KEY ("hallId","weekday","userId")
);

-- CreateTable
CREATE TABLE "StaffShiftDay" (
    "tenantId" TEXT NOT NULL,
    "hallId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "setById" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffShiftDay_pkey" PRIMARY KEY ("hallId","date")
);

-- CreateIndex
CREATE INDEX "StaffShiftTemplate_tenantId_userId_idx" ON "StaffShiftTemplate"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "StaffShiftDay_tenantId_date_idx" ON "StaffShiftDay"("tenantId", "date");

-- AddForeignKey
ALTER TABLE "StaffShiftTemplate" ADD CONSTRAINT "StaffShiftTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffShiftTemplate" ADD CONSTRAINT "StaffShiftTemplate_hallId_tenantId_fkey" FOREIGN KEY ("hallId", "tenantId") REFERENCES "Hall"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffShiftTemplate" ADD CONSTRAINT "StaffShiftTemplate_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffShiftTemplate" ADD CONSTRAINT "StaffShiftTemplate_assignedById_tenantId_fkey" FOREIGN KEY ("assignedById", "tenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffShiftDay" ADD CONSTRAINT "StaffShiftDay_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffShiftDay" ADD CONSTRAINT "StaffShiftDay_hallId_tenantId_fkey" FOREIGN KEY ("hallId", "tenantId") REFERENCES "Hall"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffShiftDay" ADD CONSTRAINT "StaffShiftDay_setById_tenantId_fkey" FOREIGN KEY ("setById", "tenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- День недели — ISO: 1 — понедельник, 7 — воскресенье. То же — в constraints.sql.
ALTER TABLE "StaffShiftTemplate"
  ADD CONSTRAINT "StaffShiftTemplate_weekday_range" CHECK ("weekday" BETWEEN 1 AND 7);

-- Перенос: каждый день, где уже кто-то назначен, — назначен вручную тем, кто
-- назначил первым.
INSERT INTO "StaffShiftDay" ("tenantId", "hallId", "date", "setById", "setAt")
SELECT DISTINCT ON ("hallId", "date") "tenantId", "hallId", "date", "assignedById", "createdAt"
FROM "StaffShift"
ORDER BY "hallId", "date", "createdAt";
