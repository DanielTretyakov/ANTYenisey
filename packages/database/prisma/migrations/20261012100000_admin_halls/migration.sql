-- Залы администратора (решение владельца от 12.10.2026): в «Настройках» и
-- «Расписании залов» администратор правит только отмеченные ему залы.

-- CreateTable
CREATE TABLE "AdminHall" (
    "userId" TEXT NOT NULL,
    "hallId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "AdminHall_pkey" PRIMARY KEY ("userId","hallId")
);

-- CreateIndex
CREATE INDEX "AdminHall_hallId_idx" ON "AdminHall"("hallId");

-- CreateIndex
CREATE INDEX "AdminHall_tenantId_idx" ON "AdminHall"("tenantId");

-- AddForeignKey
ALTER TABLE "AdminHall" ADD CONSTRAINT "AdminHall_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminHall" ADD CONSTRAINT "AdminHall_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminHall" ADD CONSTRAINT "AdminHall_hallId_tenantId_fkey" FOREIGN KEY ("hallId", "tenantId") REFERENCES "Hall"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Нынешние администраторы правили любой зал своего клуба — после выкладки
-- они не должны потерять доступ молча: привязываем их ко всем залам клуба.
-- Руководство потом снимет лишнее в «Составе клуба».
INSERT INTO "AdminHall" ("userId", "hallId", "tenantId")
SELECT m."userId", h."id", m."tenantId"
FROM "TenantMembership" m
JOIN "Hall" h ON h."tenantId" = m."tenantId"
WHERE 'ADMIN' = ANY (m."roles")
ON CONFLICT DO NOTHING;
