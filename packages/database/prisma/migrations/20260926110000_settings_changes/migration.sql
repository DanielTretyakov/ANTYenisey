-- Отложенные правки настроек клуба (решение владельца от 26.09.2026): всё со
-- страницы «Настройки», кроме оформления, вступает в силу в ближайшую полночь.

-- CreateEnum
CREATE TYPE "SettingsChangeKind" AS ENUM ('CLUB', 'HALL_CREATE', 'HALL_UPDATE', 'HALL_DELETE', 'TABLE_CREATE', 'TABLE_RENAME', 'TABLE_DELETE');

-- CreateTable
CREATE TABLE "SettingsChange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "SettingsChangeKind" NOT NULL,
    "targetId" TEXT,
    "payload" JSONB NOT NULL,
    "summary" TEXT[],
    "authorId" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "failedAt" TIMESTAMP(3),
    "failure" TEXT,

    CONSTRAINT "SettingsChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SettingsChange_tenantId_createdAt_idx" ON "SettingsChange"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "SettingsChange_effectiveAt_idx" ON "SettingsChange"("effectiveAt");

-- AddForeignKey
ALTER TABLE "SettingsChange" ADD CONSTRAINT "SettingsChange_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettingsChange" ADD CONSTRAINT "SettingsChange_authorId_tenantId_fkey" FOREIGN KEY ("authorId", "tenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettingsChange" ADD CONSTRAINT "SettingsChange_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CHECK — те же, что в constraints.sql, раздел 30.
ALTER TABLE "SettingsChange"
  ADD CONSTRAINT "SettingsChange_one_outcome"
  CHECK (
    (("appliedAt" IS NOT NULL)::int + ("cancelledAt" IS NOT NULL)::int + ("failedAt" IS NOT NULL)::int) <= 1
  );

ALTER TABLE "SettingsChange"
  ADD CONSTRAINT "SettingsChange_failure_explained"
  CHECK (("failedAt" IS NULL) = ("failure" IS NULL));

-- Отменивший может исчезнуть (SET NULL при уборке пробных учёток), поэтому
-- связь односторонняя: без отмены отменившего нет.
ALTER TABLE "SettingsChange"
  ADD CONSTRAINT "SettingsChange_canceller_only_if_cancelled"
  CHECK ("cancelledById" IS NULL OR "cancelledAt" IS NOT NULL);

ALTER TABLE "SettingsChange"
  ADD CONSTRAINT "SettingsChange_target_matches_kind"
  CHECK (("kind" = 'CLUB') = ("targetId" IS NULL));

ALTER TABLE "SettingsChange"
  ADD CONSTRAINT "SettingsChange_summary_present"
  CHECK (cardinality("summary") BETWEEN 1 AND 60);
