-- Несколько ролей у человека в клубе (решение владельца от 26.09.2026):
-- столбец role становится массивом roles, данные переносятся как есть.

ALTER TABLE "TenantMembership" ADD COLUMN "roles" "Role"[] NOT NULL DEFAULT ARRAY['CLIENT']::"Role"[];
UPDATE "TenantMembership" SET "roles" = ARRAY["role"];

-- Правила тренерского состава смотрели на role — теперь на roles.
ALTER TABLE "TenantMembership" DROP CONSTRAINT "TenantMembership_coach_list_only_coach";
ALTER TABLE "TenantMembership"
  ADD CONSTRAINT "TenantMembership_coach_list_only_coach"
  CHECK ("coachListOrder" IS NULL OR ('COACH' = ANY ("roles") AND "coachListOrder" BETWEEN 1 AND 100));

ALTER TABLE "TenantMembership" DROP CONSTRAINT "TenantMembership_coach_hidden_only_coach";
ALTER TABLE "TenantMembership"
  ADD CONSTRAINT "TenantMembership_coach_hidden_only_coach"
  CHECK ("coachHidden" = false OR 'COACH' = ANY ("roles"));

DROP INDEX "TenantMembership_tenantId_role_idx";
ALTER TABLE "TenantMembership" DROP COLUMN "role";

CREATE INDEX "TenantMembership_tenantId_idx" ON "TenantMembership"("tenantId");
CREATE INDEX "TenantMembership_roles_idx" ON "TenantMembership" USING GIN ("roles");

ALTER TABLE "TenantMembership"
  ADD CONSTRAINT "TenantMembership_roles_sane"
  CHECK (
    cardinality("roles") BETWEEN 1 AND 5
    AND ('CLIENT' <> ALL ("roles") OR cardinality("roles") = 1)
  );

-- Управляющий зала.
ALTER TABLE "Hall" ADD COLUMN "managerId" TEXT;
CREATE INDEX "Hall_managerId_idx" ON "Hall"("managerId");
ALTER TABLE "Hall" ADD CONSTRAINT "Hall_managerId_tenantId_fkey"
  FOREIGN KEY ("managerId", "tenantId") REFERENCES "TenantMembership"("userId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
