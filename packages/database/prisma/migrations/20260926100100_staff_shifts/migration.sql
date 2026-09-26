-- Смены администраторов (решение владельца от 26.09.2026): кто работает в
-- зале в какой день. Ключи составные по клубу.

-- CreateTable
CREATE TABLE "StaffShift" (
    "tenantId" TEXT NOT NULL,
    "hallId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffShift_pkey" PRIMARY KEY ("hallId","date","userId")
);

-- CreateIndex
CREATE INDEX "StaffShift_tenantId_date_idx" ON "StaffShift"("tenantId", "date");

-- CreateIndex
CREATE INDEX "StaffShift_userId_date_idx" ON "StaffShift"("userId", "date");

-- AddForeignKey
ALTER TABLE "StaffShift" ADD CONSTRAINT "StaffShift_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffShift" ADD CONSTRAINT "StaffShift_hallId_tenantId_fkey" FOREIGN KEY ("hallId", "tenantId") REFERENCES "Hall"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffShift" ADD CONSTRAINT "StaffShift_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffShift" ADD CONSTRAINT "StaffShift_assignedById_tenantId_fkey" FOREIGN KEY ("assignedById", "tenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

